// commands-lifecycle: split from pipeline-pre.mjs (pure move).
import {
  decideCiFailed,
  issueFromBranch,
  branchIssueEligible,
  planPrClosed,
  stageTransition,
  clearStages,
  prClosedOutcome,
  parseFlags,
  STAGE_STATUS,
} from '../pipeline-lib.mjs';
import {
  api,
  OWNER,
  NAME,
  graphql,
  list,
  setOutput,
  editLabels,
  labelsOf,
} from '../github.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { botLogin, many, num, writeOutcome } from './helpers.mjs';

export const lifecycleCommands = {
  // CI failed on a PR (ci-failed.yml, workflow_run). Pipeline PRs only:
  // appends a `ci_failed` outcome note for the router.
  'ci-failed'([pr, sha, runUrl]) {
    const n = num(pr);
    const decision = decideCiFailed({
      pr: api(`pulls/${n}`),
      runHeadSha: sha,
      botLogin: botLogin(),
      repo: `${OWNER}/${NAME}`,
    });
    console.log(
      `ci-failed: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );
    if (decision.action === 'noop') return;
    // A problem outcome sets stage:routing; the router hands it on.
    writeOutcome(n, {
      stage: 'ci',
      result: 'problem',
      problem: decision.problem,
      summary: `CI failed on the agent PR at ${sha.slice(0, 7)}.`,
      details: ['Push a fix to the branch, or take the PR over by hand.'],
      run_url: runUrl,
    });
  },

  // done.yml, read-only: what to do about a closed PR (see planPrClosed).
  // Writes the plan to `outFile` for `pr-closed`, and the board's node ids.
  'pr-closed-plan'([pr, outFile]) {
    const n = num(pr);
    const repo = `${OWNER}/${NAME}`;
    const p = graphql(
      `
        query ($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              id
              merged
              mergedAt
              headRefName
              headRepository {
                nameWithOwner
              }
              labels(first: 100) {
                nodes {
                  name
                }
              }
              closingIssuesReferences(first: 20) {
                nodes {
                  id
                  number
                  state
                }
              }
            }
          }
        }
      `,
      { owner: OWNER, name: NAME, number: n },
    ).repository.pullRequest;
    let linked = p.closingIssuesReferences.nodes.map((i) => ({
      id: i.id,
      number: i.number,
      state: i.state.toLowerCase(),
    }));
    if (!linked.length) {
      const b = issueFromBranch({
        headRef: p.headRefName,
        headRepo: p.headRepository?.nameWithOwner,
        repo,
      });
      let issue = null;
      try {
        issue = b ? api(`issues/${b}`) : null;
      } catch {
        issue = null; // no such issue
      }
      if (
        branchIssueEligible({ issue, merged: p.merged, mergedAt: p.mergedAt })
      )
        linked = [{ id: issue.node_id, number: b, state: issue.state }];
    }
    // A replacement PR: another open same-repo PR that closes the issue or
    // is on its issue-<n>- branch.
    const openPrs = p.merged ? [] : list('pulls?state=open');
    const issues = linked.map((i) => ({
      ...i,
      openPrs: p.merged
        ? []
        : [
            ...graphql(
              `
                query ($owner: String!, $name: String!, $number: Int!) {
                  repository(owner: $owner, name: $name) {
                    issue(number: $number) {
                      closedByPullRequestsReferences(
                        first: 20
                        includeClosedPrs: false
                      ) {
                        nodes {
                          number
                        }
                      }
                    }
                  }
                }
              `,
              { owner: OWNER, name: NAME, number: i.number },
            ).repository.issue.closedByPullRequestsReferences.nodes.map(
              (x) => x.number,
            ),
            ...openPrs
              .filter(
                (o) =>
                  issueFromBranch({
                    headRef: o.head.ref,
                    headRepo: o.head.repo?.full_name,
                    repo,
                  }) === i.number,
              )
              .map((o) => o.number),
          ],
    }));
    const plan = planPrClosed({
      pr: {
        number: n,
        merged: p.merged,
        labels: p.labels.nodes.map((l) => l.name),
      },
      issues,
    });
    console.log(
      `pr-closed-plan: ${plan.act ? plan.reason : `noop (${plan.reason})`}; ${plan.issues.map((i) => `#${i.number} ${i.action} (${i.reason})`).join(', ') || 'no issues'}`,
    );
    writeFileSync(
      outFile,
      JSON.stringify({ ...plan, closedBy: process.env.CLOSED_BY ?? '' }),
    );
    setOutput('act', String(plan.act));
    setOutput('pr_node_id', plan.act ? p.id : '');
    setOutput(
      'issue_node_ids',
      plan.issues
        .filter((i) => i.action === 'done')
        .map((i) => linked.find((l) => l.number === i.number).id)
        .join(' '),
    );
  },

  // done.yml, App token: applies a pr-closed-plan. Merged: stage:done on
  // the PR and its issues. Closed: a pr_closed note on each issue to route.
  'pr-closed'([file]) {
    const plan = JSON.parse(readFileSync(file, 'utf8'));
    if (!plan.act) return;
    const pr = num(plan.pr.number);
    if (plan.pr.labels === 'done')
      editLabels(pr, stageTransition(labelsOf(pr), 'stage:done'));
    else editLabels(pr, clearStages(labelsOf(pr)));
    for (const i of plan.issues) {
      const n = num(i.number);
      if (i.action === 'done')
        editLabels(n, stageTransition(labelsOf(n), 'stage:done'));
      else if (i.action === 'route')
        writeOutcome(n, prClosedOutcome({ pr, closedBy: plan.closedBy }));
    }
  },

  'project-status'(args) {
    const f = parseFlags(args);
    const m = /github\.com\/(users|orgs)\/([^/]+)\/projects\/(\d+)/.exec(
      f['project-url'] ?? '',
    );
    if (!m)
      throw new Error(
        'PROJECT_URL must look like https://github.com/users/<login>/projects/<n>',
      );
    const [, kind, login, number] = m;
    const owner = kind === 'users' ? 'user' : 'organization';
    const status = STAGE_STATUS[f.status] ?? f.status;
    const project = graphql(
      `query($login:String!,$number:Int!){ ${owner}(login:$login){ projectV2(number:$number){ id
        field(name:"Status"){ ... on ProjectV2SingleSelectField { id options{ id name } } } } } }`,
      { login, number: Number(number) },
    )[owner].projectV2;
    const option = project.field?.options.find((o) => o.name === status);
    if (!option)
      throw new Error(
        `Project has no Status option "${status}". Run tools/scripts/pipeline/setup-project.sh.`,
      );
    for (const contentId of many(f['content-id'])
      .flatMap((s) => s.split(' '))
      .filter(Boolean)) {
      const itemId = graphql(
        `
          mutation ($p: ID!, $c: ID!) {
            addProjectV2ItemById(input: { projectId: $p, contentId: $c }) {
              item {
                id
              }
            }
          }
        `,
        { p: project.id, c: contentId },
      ).addProjectV2ItemById.item.id;
      f['item-id'] = [...many(f['item-id']), itemId];
    }
    for (const itemId of many(f['item-id'])) {
      graphql(
        `
          mutation ($p: ID!, $i: ID!, $f: ID!, $o: String!) {
            updateProjectV2ItemFieldValue(
              input: {
                projectId: $p
                itemId: $i
                fieldId: $f
                value: { singleSelectOptionId: $o }
              }
            ) {
              projectV2Item {
                id
              }
            }
          }
        `,
        { p: project.id, i: itemId, f: project.field.id, o: option.id },
      );
      console.log(`Project item ${itemId} -> ${status}`);
    }
  },
};
