#!/usr/bin/env node
// Deterministic pipeline steps, called from .github/workflows/*.yml.
// Usage: node .github/scripts/pipeline.mjs <command> [args...]
import { readFileSync, writeFileSync } from 'node:fs';
import {
  COPILOT_LOGINS,
  COPILOT_REVIEWER,
  MARKERS,
  STAGE_STATUS,
  applyLabels,
  branchName,
  buildSecurityReview,
  checkPatch,
  decideCiFailed,
  decideFix,
  emptyState,
  evaluateApproval,
  isPipelinePr,
  issueForAgents,
  parseSecurityReport,
  parseState,
  previewUrl,
  promptVersion,
  renderPrompt,
  renderState,
  resetFixLoop,
  sameLogin,
  selectActionable,
  stageTransition,
  threadsToResolve,
  validateSpec,
} from './pipeline-lib.mjs';
import {
  NAME,
  OWNER,
  api,
  editLabels,
  findComment,
  graphql,
  labelsOf,
  list,
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

/** The pipeline App's bot login (`vars.PIPELINE_BOT_LOGIN`). Required. */
function botLogin() {
  const login = process.env.PIPELINE_BOT_LOGIN;
  if (!login) throw new Error('PIPELINE_BOT_LOGIN is not set');
  return login;
}

/** Marker comments are trusted only when the pipeline bot wrote them. */
const findBotComment = (number, marker) =>
  findComment(number, marker, { author: botLogin() });
const upsertBotComment = (number, marker, body) =>
  upsertComment(number, marker, body, { author: botLogin() });

// ------------------------------------------------------------ state

function readState(pr) {
  const c = findBotComment(pr, MARKERS.state);
  return c ? parseState(c.body) : emptyState();
}

function writeState(pr, state, labels = labelsOf(pr)) {
  upsertBotComment(pr, MARKERS.state, renderState(state, labels));
}

function setStage(number, stage) {
  editLabels(number, stageTransition(labelsOf(number), stage));
}

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

  // COMMENT_AUTHOR overrides the author to match, for comments posted with
  // GITHUB_TOKEN (github-actions[bot]) instead of the pipeline App.
  'upsert-comment'([number, markerKey, file]) {
    const marker = MARKERS[markerKey];
    if (!marker) throw new Error(`Unknown marker ${markerKey}`);
    upsertComment(num(number), marker, readFileSync(file, 'utf8'), {
      author: process.env.COMMENT_AUTHOR || botLogin(),
    });
  },

  // Issue + comments for the plan/develop agents, with the spec and plan
  // taken only from the bot's own marker comments.
  'collect-issue'([number, outFile]) {
    const n = num(number);
    const data = issueForAgents({
      issue: api(`issues/${n}`),
      comments: list(`issues/${n}/comments`),
      botLogin: botLogin(),
    });
    writeFileSync(outFile, JSON.stringify(data, null, 2));
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
    const res = checkPatch(readFileSync(file, 'utf8'));
    if (res.forbidden.length)
      console.error(
        `Patch touches protected paths: ${res.forbidden.join(', ')}`,
      );
    for (const e of res.errors) console.error(`Patch rejected: ${e}`);
    if (!res.ok) process.exit(1);
  },

  'init-state'([pr]) {
    const n = num(pr);
    if (findBotComment(n, MARKERS.state)) return;
    const created = api(`pulls/${n}`).created_at;
    writeState(n, { ...emptyState(), watermark: created });
  },

  'fix-adapter'([pr, outFile]) {
    const n = num(pr);
    const bot = botLogin();
    const p = api(`pulls/${n}`);
    if (
      !isPipelinePr({
        author: p.user?.login,
        headRef: p.head?.ref,
        headRepo: p.head?.repo?.full_name,
        repo: `${OWNER}/${NAME}`,
        botLogin: bot,
      })
    ) {
      console.log(
        `fix-adapter: noop (PR #${n} by ${p.user?.login} on ${p.head?.ref} was not opened by the pipeline)`,
      );
      writeFileSync(outFile, '[]');
      setOutput('action', 'noop');
      setOutput('loop', '');
      return;
    }
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
      botLogin: bot,
    });
    const decision = decideFix({ labels, actionable });
    console.log(
      `fix-adapter: ${decision.action} (${decision.reason ?? `loop ${decision.loop}`})`,
    );
    writeFileSync(outFile, JSON.stringify(actionable, null, 2));
    setOutput('action', decision.action);
    setOutput('loop', String(decision.loop ?? ''));
    if (decision.action === 'noop') return;

    // Record before acting: a rerun with no newer comments is a no-op, and
    // a crash after this line cannot spend the same round twice.
    const next = {
      ...state,
      watermark,
      handled: [
        ...new Set([...state.handled, ...actionable.map((a) => a.key)]),
      ],
    };
    const edit = { add: decision.add, remove: decision.remove };
    writeState(n, next, applyLabels(labels, edit));
    editLabels(n, edit);
    if (decision.action === 'escalate')
      upsertBotComment(
        n,
        MARKERS.notice,
        `**Pipeline stopped: needs attention.** ${decision.reason}; ${actionable.length} new review item(s) remain. A human needs to take over this PR. Removing \`stage:needs-attention\` restarts the fix loop with a fresh budget.`,
      );
  },

  'fix-reply'([pr, sha, itemsFile]) {
    const n = num(pr);
    const items = JSON.parse(readFileSync(itemsFile, 'utf8'));
    const autoResolve = [botLogin(), ...COPILOT_LOGINS];
    const short = sha.slice(0, 7);
    for (const it of items.filter((i) => i.kind === 'inline')) {
      api(`pulls/${n}/comments/${it.id}/replies`, {
        method: 'POST',
        body: {
          body: `${MARKERS.fixReply}\nAddressed in ${short} (automated fix). Please re-check.`,
        },
      });
    }
    // Resolve only all-bot threads; any human comment keeps it open.
    for (const t of threadsToResolve(
      reviewThreads(n),
      items.filter((i) => i.kind === 'inline').map((i) => i.id),
      autoResolve,
    ))
      resolveThread(t.id);
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
    const bot = botLogin();
    const already = list(`pulls/${n}/reviews`).some(
      (r) =>
        sameLogin(r.user?.login, bot) &&
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
      setStage(n, 'stage:needs-attention');
      upsertBotComment(
        n,
        MARKERS.notice,
        `**Security review failed:** ${report.error}. A human needs to review this PR.`,
      );
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
        setStage(n, 'stage:needs-attention');
        upsertBotComment(
          n,
          MARKERS.notice,
          '**Could not request a Copilot review.** Check that Copilot code review is enabled for this repo and that `COPILOT_REVIEW_TOKEN` belongs to a user with Copilot access.',
        );
        throw e;
      } finally {
        process.env.GH_TOKEN = saved;
      }
      writeState(n, { ...state, copilotRequestedFor: head });
    }

    if (decision.action === 'human-approval') {
      // Later human feedback starts a fresh fix budget.
      editLabels(n, resetFixLoop(labels, 'stage:human-approval'));
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
      upsertBotComment(
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

  // CI failed on a PR (security.yml, workflow_run). Pipeline PRs only.
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
    setStage(n, 'stage:needs-attention');
    upsertBotComment(
      n,
      MARKERS.noticeCi,
      [
        `**CI failed on the agent PR; needs attention.** Problem: \`${decision.problem}\` (commit \`${sha.slice(0, 7)}\`).`,
        `See the run: ${runUrl}`,
        'Push a fix to the branch (or take the PR over by hand). The next green CI run starts the security review again and moves the PR on.',
      ].join('\n\n'),
    );
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
