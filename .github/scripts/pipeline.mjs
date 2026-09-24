#!/usr/bin/env node
// Deterministic pipeline steps, called from .github/workflows/*.yml.
// Usage: node .github/scripts/pipeline.mjs <command> [args...]
import { readFileSync, writeFileSync } from 'node:fs';
import {
  COPILOT_LOGINS,
  COPILOT_REVIEWER,
  MARKERS,
  STAGE_STATUS,
  allowedTargets,
  branchName,
  buildSecurityReview,
  classifyDevelop,
  classifyFix,
  classifyPlan,
  classifySpec,
  collectRouterInput,
  decideFix,
  decideFixRetry,
  emptyState,
  evaluateApproval,
  forbiddenPaths,
  normalizeOutcome,
  parseSecurityReport,
  parseState,
  patchPaths,
  planRoute,
  previewUrl,
  promptVersion,
  renderOutcome,
  renderPrompt,
  renderState,
  selectActionable,
  stageTransition,
  validateSpec,
} from './pipeline-lib.mjs';
import { decideExternal } from './router-external.mjs';
import {
  NAME,
  OWNER,
  api,
  editLabels,
  findComment,
  graphql,
  labelsOf,
  list,
  postComment,
  resolveThread,
  reviewThreads,
  setOutput,
  upsertComment,
} from './github.mjs';

const [, , command, ...argv] = process.argv;

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const val = args[++i];
    if (out[key] === undefined) out[key] = val;
    else out[key] = [].concat(out[key], val);
  }
  return out;
}
const many = (v) => (v === undefined ? [] : [].concat(v));
const num = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`Expected a number, got ${v}`);
  return n;
};

// ------------------------------------------------------------ state

function readState(pr) {
  const c = findComment(pr, MARKERS.state);
  return c ? parseState(c.body) : emptyState();
}

function writeState(pr, state) {
  upsertComment(pr, MARKERS.state, renderState(state, labelsOf(pr)));
}

function setStage(number, stage) {
  editLabels(number, stageTransition(labelsOf(number), stage));
}

// ------------------------------------------------------------ outcomes

function runUrl() {
  const { RUN_URL, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } =
    process.env;
  if (RUN_URL) return RUN_URL;
  return GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : '';
}

/**
 * Appends an outcome note. A problem hands the item to the router
 * (stage:routing); on success the caller moves to the next stage itself.
 */
function writeOutcome(number, input) {
  const outcome = normalizeOutcome({
    ...input,
    run_url: input.run_url || runUrl(),
    item: number,
  });
  postComment(number, renderOutcome(outcome));
  if (outcome.result === 'problem') setStage(number, 'stage:routing');
  setOutput('result', outcome.result);
  setOutput('problem', outcome.problem);
  return outcome;
}

const readIf = (path) => (path ? readFileSync(path, 'utf8') : '');

// Per-stage classifiers: workflow job results + agent output -> outcome.
const classifiers = {
  spec: (f) =>
    classifySpec({ jobResult: f['job-result'], spec: readIf(f.output) }),
  plan: (f) =>
    classifyPlan({ jobResult: f['job-result'], raw: readIf(f.result) }),
  develop: (f) =>
    classifyDevelop({
      implementResult: f['job-result'],
      publishResult: f['publish-result'],
      raw: readIf(f.result),
      patchRejected: f['patch-rejected'] === 'true',
    }),
  fix: (f) =>
    classifyFix({
      fixResult: f['job-result'],
      pushResult: f['push-result'],
      patchRejected: f['patch-rejected'] === 'true',
    }),
};

// ------------------------------------------------------------ commands

const commands = {
  'render-prompt'(args) {
    const f = flags(args);
    const promptText = readFileSync(f.prompt, 'utf8');
    const context = Object.fromEntries(
      many(f.context).map((kv) => [
        kv.slice(0, kv.indexOf('=')),
        kv.slice(kv.indexOf('=') + 1),
      ]),
    );
    context['prompt version'] = `${f.prompt}@${promptVersion(promptText)}`;
    const data = many(f.data).map((kv) => {
      const [name, path] = [
        kv.slice(0, kv.indexOf('=')),
        kv.slice(kv.indexOf('=') + 1),
      ];
      return { name, path, content: readFileSync(path, 'utf8') };
    });
    const prompt = renderPrompt({ promptText, context, data });
    if (f.out) writeFileSync(f.out, prompt);
    if (f.output) setOutput(f.output, prompt);
    setOutput('version', promptVersion(promptText));
  },

  'set-stage'([number, stage]) {
    setStage(num(number), stage);
  },

  'edit-labels'(args) {
    const f = flags(args);
    editLabels(num(f._[0]), { add: many(f.add), remove: many(f.remove) });
  },

  // Appends an outcome note from a JSON file; a problem sets stage:routing.
  outcome([number, file]) {
    writeOutcome(num(number), JSON.parse(readFileSync(file, 'utf8')));
  },

  // Builds a stage's outcome JSON (not posted) from job results and output.
  classify([stage, ...rest]) {
    const f = flags(rest);
    if (!classifiers[stage]) throw new Error(`No classifier for ${stage}`);
    const outcome = normalizeOutcome({
      ...classifiers[stage](f),
      prompt_version: f['prompt-version'] ?? '',
    });
    writeFileSync(f.out, JSON.stringify(outcome));
    setOutput('result', outcome.result);
    setOutput('problem', outcome.problem);
  },

  // Read-only: asks the external brain for a pick (router.yml `brain` job).
  async 'route-external'([number]) {
    const { outcome, history } = collectRouterInput({
      comments: list(`issues/${num(number)}/comments`),
      botLogin: process.env.PIPELINE_BOT_LOGIN,
    });
    const allowed = outcome
      ? allowedTargets(outcome.stage, outcome.problem)
      : ['human'];
    const pick = outcome
      ? await decideExternal({ outcome, history, allowed })
      : null;
    setOutput('pick', JSON.stringify(pick ?? null));
  },

  // The router: read the notes, decide, append a route note, apply it.
  route([number]) {
    const n = num(number);
    const item = api(`issues/${n}`);
    let external = null;
    try {
      external = JSON.parse(process.env.ROUTER_EXTERNAL_PICK || 'null');
    } catch {
      external = null;
    }
    // develop.yml publishes nothing while a PR for the issue is open.
    const openPullRequest =
      !item.pull_request &&
      list('pulls?state=open').some(
        (p) =>
          p.head.ref.startsWith(`issue-${n}-`) &&
          p.head.repo?.full_name === `${OWNER}/${NAME}`,
      );
    const r = planRoute({
      comments: list(`issues/${n}/comments`),
      botLogin: process.env.PIPELINE_BOT_LOGIN,
      mode: process.env.ROUTER_MODE === 'external' ? 'external' : 'rules',
      shadow: process.env.ROUTER_SHADOW === 'true',
      external,
      facts: { openPullRequest },
    });
    console.log(
      `route: ${r.outcome?.stage ?? '-'}/${r.outcome?.problem ?? '-'} -> ${r.final.target} (${r.final.reason})`,
    );
    postComment(n, r.body);
    setStage(n, r.stage);
    setOutput('target', r.final.target);
    setOutput(
      'retry_pr',
      r.final.target === 'retry' && r.outcome?.stage === 'fix' ? String(n) : '',
    );
  },

  'upsert-comment'([number, markerKey, file]) {
    const marker = MARKERS[markerKey];
    if (!marker) throw new Error(`Unknown marker ${markerKey}`);
    upsertComment(num(number), marker, readFileSync(file, 'utf8'));
  },

  'branch-name'([number]) {
    setOutput('branch', branchName(num(number), process.env.ISSUE_TITLE ?? ''));
  },

  'validate-spec'([file]) {
    const res = validateSpec(readFileSync(file, 'utf8'));
    setOutput('ok', String(res.ok));
    setOutput('missing', res.missing.join(', '));
  },

  'check-patch'([file]) {
    const bad = forbiddenPaths(patchPaths(readFileSync(file, 'utf8')));
    if (bad.length) {
      console.error(`Patch touches protected paths: ${bad.join(', ')}`);
      process.exit(1);
    }
  },

  'init-state'([pr]) {
    const n = num(pr);
    if (findComment(n, MARKERS.state)) return;
    const created = api(`pulls/${n}`).created_at;
    writeState(n, { ...emptyState(), watermark: created });
  },

  // `mode` is 'retry' when the router re-runs a round whose fixer failed.
  'fix-adapter'([pr, outFile, mode]) {
    const n = num(pr);
    const retry = mode === 'retry';
    const labels = labelsOf(n);
    const state = readState(n);
    const threads = reviewThreads(n);
    const resolvedCommentIds = new Set(
      threads.filter((t) => t.isResolved).flatMap((t) => t.commentIds),
    );
    const { actionable, watermark } = selectActionable({
      reviews: list(`pulls/${n}/reviews`),
      reviewComments: list(`pulls/${n}/comments`),
      resolvedCommentIds,
      state,
      onlyKeys: retry ? new Set(state.lastBatch) : null,
    });
    const decision = retry
      ? decideFixRetry({ labels, batch: actionable })
      : decideFix({ labels, actionable });
    console.log(
      `fix-adapter: ${decision.action} (${decision.reason ?? `loop ${decision.loop}${retry ? ', retry' : ''}`})`,
    );
    writeFileSync(outFile, JSON.stringify(actionable, null, 2));
    setOutput('action', decision.action);
    setOutput('loop', String(decision.loop ?? ''));
    if (decision.action === 'noop') return;
    if (retry) {
      setStage(n, 'stage:fixing');
      return;
    }

    // Record before acting: a rerun with no newer comments is a no-op.
    const next = {
      ...state,
      watermark,
      handled: [
        ...new Set([...state.handled, ...actionable.map((a) => a.key)]),
      ],
      lastBatch: actionable.map((a) => a.key),
    };
    if (decision.action === 'escalate') {
      writeOutcome(n, {
        stage: 'fix',
        result: 'problem',
        problem: 'budget_exhausted',
        details: [
          `${decision.reason}; ${actionable.length} new review item(s) remain.`,
        ],
      });
    } else {
      editLabels(n, stageTransition(labels, 'stage:fixing'));
      editLabels(n, {
        add: decision.add.filter((l) => !l.startsWith('stage:')),
        remove: decision.remove,
      });
    }
    writeState(n, next);
  },

  'fix-reply'([pr, sha, itemsFile]) {
    const n = num(pr);
    const items = JSON.parse(readFileSync(itemsFile, 'utf8'));
    const bot = process.env.PIPELINE_BOT_LOGIN ?? '';
    const autoResolve = new Set([bot, ...COPILOT_LOGINS].filter(Boolean));
    const short = sha.slice(0, 7);
    for (const it of items.filter((i) => i.kind === 'inline')) {
      api(`pulls/${n}/comments/${it.id}/replies`, {
        method: 'POST',
        body: {
          body: `${MARKERS.fixReply}\nAddressed in ${short} (automated fix). Please re-check.`,
        },
      });
    }
    // Resolve only threads opened by bots; human threads stay for the human.
    const ids = new Set(
      items.filter((i) => i.kind === 'inline').map((i) => i.id),
    );
    for (const t of reviewThreads(n)) {
      if (
        !t.isResolved &&
        t.commentIds.some((id) => ids.has(id)) &&
        autoResolve.has(t.authors[0])
      )
        resolveThread(t.id);
    }
    const reviewItems = items.filter((i) => i.kind === 'review');
    if (reviewItems.length) {
      api(`issues/${n}/comments`, {
        method: 'POST',
        body: {
          body: `${MARKERS.fixReply}\nAddressed review feedback from ${reviewItems
            .map((i) => `@${i.author}`)
            .join(', ')} in ${short} (automated fix).`,
        },
      });
    }
  },

  'security-publish'([pr, sha, responseFile, promptVer]) {
    const n = num(pr);
    const head = api(`pulls/${n}`).head.sha;
    if (head !== sha) {
      console.log(`Head moved (${head}); skipping stale review of ${sha}.`);
      return;
    }
    const already = list(`pulls/${n}/reviews`).some((r) =>
      r.body?.includes(`${MARKERS.securityReview} sha=${sha}`),
    );
    if (already) {
      console.log('Security review for this commit already posted.');
      return;
    }
    const status = (state, description) =>
      api(`statuses/${sha}`, {
        method: 'POST',
        body: {
          state,
          context: 'pipeline/security',
          description: description.slice(0, 140),
        },
      });
    const report = parseSecurityReport(readFileSync(responseFile, 'utf8'));
    if (!report.ok) {
      status('error', report.error);
      writeOutcome(n, {
        stage: 'security',
        result: 'problem',
        problem: 'invalid_output',
        summary: `Security review stopped: ${report.error}.`,
        prompt_version: `security-review.md@${promptVer}`,
      });
      process.exitCode = 1;
      return;
    }
    const review = buildSecurityReview({
      report,
      sha,
      files: list(`pulls/${n}/files`),
      promptVer,
    });
    const post = (comments) =>
      api(`pulls/${n}/reviews`, {
        method: 'POST',
        body: { commit_id: sha, event: 'COMMENT', body: review.body, comments },
      });
    try {
      post(review.comments);
    } catch {
      // Line mapping rejected: fall back to one actionable body.
      const extra = review.comments.map(
        (c) => `- ${c.path}:${c.line}: ${c.body.replace(/\n\n/g, '\n  ')}`,
      );
      review.body = [
        review.body,
        MARKERS.actionable,
        '#### Findings',
        ...extra,
      ].join('\n\n');
      post([]);
    }
    status(
      review.clean ? 'success' : 'failure',
      review.clean
        ? 'No blocking findings'
        : `${review.blockingCount} blocking finding(s)`,
    );
    writeOutcome(n, {
      stage: 'security',
      result: 'success',
      summary: `Security review of ${sha.slice(0, 7)}: ${review.clean ? 'clean' : `${review.blockingCount} blocking finding(s)`}.`,
      prompt_version: `security-review.md@${promptVer}`,
    });
    setStage(n, 'stage:reviewing');
    setOutput('clean', String(review.clean));
  },

  approval([pr]) {
    const n = num(pr);
    const p = api(`pulls/${n}`);
    const head = p.head.sha;
    const labels = labelsOf(n);
    const runs = api(
      `commits/${head}/check-runs?check_name=ci&per_page=100`,
    ).check_runs;
    const ci = runs.sort((a, b) => b.id - a.id)[0]?.conclusion ?? null;
    const sec = api(`commits/${head}/statuses?per_page=100`).find(
      (s) => s.context === 'pipeline/security',
    )?.state;
    const unresolved = reviewThreads(n).filter((t) => !t.isResolved).length;
    const copilotReviewedHead = list(`pulls/${n}/reviews`).some(
      (r) => COPILOT_LOGINS.includes(r.user?.login) && r.commit_id === head,
    );
    const state = readState(n);
    const decision = evaluateApproval({
      prState: p.state,
      draft: p.draft,
      labels,
      headSha: head,
      ciConclusion: ci,
      securityState: sec,
      unresolvedThreads: unresolved,
      copilotReviewedHead,
      state,
    });
    console.log(
      `approval: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );

    if (decision.action === 'request-copilot') {
      const saved = process.env.GH_TOKEN;
      if (process.env.COPILOT_GH_TOKEN)
        process.env.GH_TOKEN = process.env.COPILOT_GH_TOKEN;
      try {
        api(`pulls/${n}/requested_reviewers`, {
          method: 'POST',
          body: { reviewers: [COPILOT_REVIEWER] },
        });
      } catch (e) {
        process.env.GH_TOKEN = saved;
        writeOutcome(n, {
          stage: 'approval',
          result: 'problem',
          problem: 'copilot_request_failed',
          summary: 'Approval stopped: could not request a Copilot review.',
          details: [
            'Check that Copilot code review is enabled for this repo and that `COPILOT_REVIEW_TOKEN` belongs to a user with Copilot access.',
          ],
        });
        throw e;
      } finally {
        process.env.GH_TOKEN = saved;
      }
      writeState(n, { ...state, copilotRequestedFor: head });
    }

    if (decision.action === 'human-approval') {
      writeOutcome(n, {
        stage: 'approval',
        result: 'success',
        summary: `Handed to human approval at ${head.slice(0, 7)}.`,
      });
      setStage(n, 'stage:human-approval');
      if (p.draft)
        graphql(
          `
            mutation ($id: ID!) {
              markPullRequestReadyForReview(input: { pullRequestId: $id }) {
                pullRequest {
                  id
                }
              }
            }
          `,
          { id: p.node_id },
        );
      const url = previewUrl(OWNER, NAME, n);
      upsertComment(
        n,
        MARKERS.humanApproval,
        [
          `### Ready for human approval`,
          `CI is green, the security review is clean, Copilot has reviewed \`${head.slice(0, 7)}\` and all threads are resolved.`,
          `**Preview:** ${url}`,
          `Code owners have been requested for review. Merging is a human decision; no agent can merge.`,
        ].join('\n\n'),
      );
      writeState(n, { ...state, humanApprovalFor: head });
    }
  },

  'linked-issues'([pr]) {
    const data = graphql(
      `
        query ($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              id
              closingIssuesReferences(first: 20) {
                nodes {
                  id
                  number
                }
              }
            }
          }
        }
      `,
      { owner: OWNER, name: NAME, number: num(pr) },
    ).repository.pullRequest;
    setOutput('pr_node_id', data.id);
    setOutput(
      'issue_node_ids',
      data.closingIssuesReferences.nodes.map((i) => i.id).join(' '),
    );
  },

  'project-status'(args) {
    const f = flags(args);
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

if (!commands[command]) {
  console.error(
    `Unknown command: ${command}\nCommands: ${Object.keys(commands).join(', ')}`,
  );
  process.exit(2);
}
try {
  await commands[command](argv);
} catch (e) {
  console.error(e.stack ?? e);
  process.exit(1);
}
