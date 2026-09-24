#!/usr/bin/env node
// Deterministic pipeline steps, called from .github/workflows/*.yml.
// Usage: node .github/scripts/pipeline.mjs <command> [args...]
import { readFileSync, writeFileSync } from 'node:fs';
import {
  COPILOT_LOGINS,
  COPILOT_REVIEWER,
  GATES_CONTEXT,
  MARKERS,
  STAGE_STATUS,
  allowedTargets,
  applyLabels,
  branchIssueEligible,
  branchName,
  buildSecurityReview,
  clearStages,
  checkDispositionAuthor,
  checkPatch,
  classifyThreads,
  classifyDevelop,
  classifyFix,
  classifyPlan,
  collectRouterInput,
  decideCiFailed,
  decideFix,
  decideFixRetry,
  dispositionKinds,
  dispositionsInEffect,
  emptyState,
  evaluateApproval,
  isPipelinePr,
  issueForAgents,
  issueFromBranch,
  normalizeOutcome,
  parseDispositionComment,
  parseDispositionNotes,
  parseSecurityReport,
  parseState,
  planPrClosed,
  planRoute,
  prClosedOutcome,
  previewUrl,
  promptVersion,
  renderDispositionNote,
  renderGatesComment,
  renderOutcome,
  renderPlanComment,
  renderPrompt,
  renderSpecComment,
  renderState,
  resetFixLoop,
  routerSkip,
  sameLogin,
  securityIdsForHead,
  securityOutcomeDetails,
  selectActionable,
  stageTransition,
  threadsToResolve,
  validateDispositions,
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

// ------------------------------------------------------------ gates

/**
 * `vars.PIPELINE_OWNER_LOGIN`: the only person whose /disposition counts.
 * Empty when unset, and then no disposition is valid.
 */
const ownerLogin = () => process.env.PIPELINE_OWNER_LOGIN ?? '';

/** Dispositions the owner made on a PR: finding id -> kind. */
function dispositionsOf(comments) {
  return dispositionKinds({
    records: parseDispositionNotes(comments, botLogin()),
    ownerLogin: ownerLogin(),
  });
}

/**
 * Sets the `pipeline/gates` commit status on `sha` unless its latest value
 * is already this one. `statuses` are the commit's statuses, newest first.
 * approval.yml runs on the `pipeline/security` context only, so this
 * status does not re-trigger it.
 */
function setGatesStatus(sha, { state, description }, statuses) {
  const current = statuses.find((s) => s.context === GATES_CONTEXT);
  const text = description.slice(0, 140);
  if (current?.state === state && current.description === text) return;
  api(`statuses/${sha}`, {
    method: 'POST',
    body: { state, context: GATES_CONTEXT, description: text },
  });
}

const readIf = (path) => (path ? readFileSync(path, 'utf8') : '');

// Per-stage classifiers: workflow job results + agent output -> outcome.
const classifiers = {
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
      verifyResult: f['verify-result'],
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
    // An approved plan run also yields its two comment bodies.
    if (stage === 'plan' && outcome.result === 'success') {
      const result = JSON.parse(readIf(f.result));
      const version = f['prompt-version'] ?? undefined;
      writeFileSync(f['spec-out'], renderSpecComment(result, version));
      writeFileSync(f['plan-out'], renderPlanComment(result, version));
    }
    setOutput('result', outcome.result);
    setOutput('problem', outcome.problem);
  },

  // Read-only: asks the external brain for a pick (router.yml `brain` job).
  async 'route-external'([number]) {
    const skip = routerSkip(api(`issues/${num(number)}`));
    if (skip) {
      console.log(`route-external: skipped (${skip})`);
      setOutput('pick', 'null');
      return;
    }
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
    const skip = routerSkip(item);
    if (skip) {
      console.log(`route: skipped (${skip})`);
      setOutput('target', '');
      setOutput('retry_pr', '');
      return;
    }
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

  // `mode` is 'retry' when the router re-runs a round whose fixer failed.
  'fix-adapter'([pr, outFile, mode]) {
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
    const retry = mode === 'retry';
    const labels = labelsOf(n);
    const state = readState(n);
    const threads = reviewThreads(n);
    const resolvedCommentIds = new Set(
      threads.filter((t) => t.isResolved).flatMap((t) => t.commentIds),
    );
    // Findings the owner accepted are not fixed (see dispositionsInEffect).
    const dispositioned = new Set(
      dispositionsOf(list(`issues/${n}/comments`)).keys(),
    );
    const { actionable, watermark } = selectActionable({
      reviews: list(`pulls/${n}/reviews`),
      reviewComments: list(`pulls/${n}/comments`),
      resolvedCommentIds,
      state,
      botLogin: bot,
      onlyKeys: retry ? new Set(state.lastBatch) : null,
      dispositioned,
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

    // Record before acting: a rerun with no newer comments is a no-op, and
    // a crash after this line cannot spend the same round twice.
    const next = {
      ...state,
      watermark,
      handled: [
        ...new Set([...state.handled, ...actionable.map((a) => a.key)]),
      ],
      lastBatch: actionable.map((a) => a.key),
    };
    const edit = { add: decision.add, remove: decision.remove };
    writeState(n, next, applyLabels(labels, edit));
    editLabels(n, edit);
    if (decision.action === 'escalate')
      writeOutcome(n, {
        stage: 'fix',
        result: 'problem',
        problem: 'budget_exhausted',
        details: [
          `${decision.reason}; ${actionable.length} new review item(s) remain.`,
        ],
      });
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
    // Findings the owner already decided on carry over by id: they open no
    // new thread on this head.
    const dispositioned = dispositionsOf(list(`issues/${n}/comments`));
    const review = buildSecurityReview({
      report,
      sha,
      files: list(`pulls/${n}/files`),
      promptVer,
      dispositioned,
    });
    const post = (body, comments) =>
      api(`pulls/${n}/reviews`, {
        method: 'POST',
        body: { commit_id: sha, event: 'COMMENT', body, comments },
      });
    try {
      post(review.body, review.comments);
    } catch {
      // Line mapping rejected: fall back to one actionable body.
      post(review.fallbackBody, []);
    }
    const counts = review.clean
      ? 'No blocking findings'
      : `${review.blockingCount} blocking finding(s)${review.dispositionedCount ? `, ${review.dispositionedCount} dispositioned` : ''}`;
    // The details list every blocking finding by id: approval and
    // /disposition read them back (securityIdsForHead). Everything approval
    // reads is written before the status, which is what triggers it.
    writeOutcome(n, {
      stage: 'security',
      result: 'success',
      summary: `Security review of ${sha.slice(0, 7)}: ${review.clean ? 'clean' : counts}.`,
      details: securityOutcomeDetails({
        sha,
        findings: review.blockingFindings,
      }),
      prompt_version: `security-review.md@${promptVer}`,
    });
    setStage(n, 'stage:reviewing');
    status(review.clean ? 'success' : 'failure', counts);
    setOutput('clean', String(review.clean));
  },

  approval([pr]) {
    const n = num(pr);
    const bot = botLogin();
    const p = api(`pulls/${n}`);
    const head = p.head.sha;
    const labels = labelsOf(n);
    // Latest conclusion of a check run: undefined when there is none, null
    // while it runs.
    const conclusionOf = (name) => {
      const runs = api(
        `commits/${head}/check-runs?check_name=${name}&per_page=100`,
      ).check_runs.sort((a, b) => b.id - a.id);
      return runs.length ? runs[0].conclusion : undefined;
    };
    const statuses = api(`commits/${head}/statuses?per_page=100`);
    const stateOf = (context) =>
      statuses.find((s) => s.context === context)?.state;
    const comments = list(`issues/${n}/comments`);
    const threads = reviewThreads(n);
    const copilotReviewedHead = list(`pulls/${n}/reviews`).some(
      (r) => COPILOT_LOGINS.includes(r.user?.login) && r.commit_id === head,
    );
    const state = readState(n);
    const records = parseDispositionNotes(comments, bot);
    const kinds = dispositionKinds({ records, ownerLogin: ownerLogin() });
    const securityFindings = securityIdsForHead({
      comments,
      botLogin: bot,
      sha: head,
    });
    const decision = evaluateApproval({
      prState: p.state,
      draft: p.draft,
      labels,
      headSha: head,
      ciConclusion: conclusionOf('ci') ?? null,
      securityJobConclusion: conclusionOf('security'),
      securityState: stateOf('pipeline/security'),
      securityFindings,
      dispositioned: new Set(kinds.keys()),
      unresolvedThreads: threads.filter((t) => !t.isResolved).length,
      copilotReviewedHead,
      protectedApprovalState: stateOf('pipeline/protected-approval') ?? null,
      state,
    });
    console.log(
      `approval: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );

    if (decision.gates) {
      console.log(
        `gates: ${decision.gates.state} (${decision.gates.description})`,
      );
      setGatesStatus(head, decision.gates, statuses);
      const open = [
        ...(securityFindings?.findings ?? [])
          .filter((f) => !kinds.has(f.id))
          .map((f) => ({ id: f.id, source: 'Gemini', text: f.text })),
        ...classifyThreads(threads, bot)
          .filter((t) => t.source === 'copilot' && !t.thread.isResolved)
          .map((t) => ({
            id: t.id,
            source: 'Copilot',
            text: `${t.thread.path ?? ''}${t.thread.line ? `:${t.thread.line}` : ''} ${t.thread.first?.body ?? ''}`,
          })),
      ];
      const body = renderGatesComment({
        head,
        gates: decision.gates,
        open,
        dispositions: [...kinds].map(([id, kind]) => ({
          id,
          kind,
          ...records.findLast((r) => r.id === id),
        })),
      });
      // Editing a comment triggers nothing; skip the write when unchanged.
      if (findBotComment(n, MARKERS.gates)?.body !== body)
        upsertBotComment(n, MARKERS.gates, body);
    }

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
          `CI is green, the Gemini security review is clean or every finding is dispositioned, Copilot has reviewed \`${head.slice(0, 7)}\`, all threads are resolved and \`${GATES_CONTEXT}\` is green.`,
          `**Preview:** ${url}`,
          `Code owners have been requested for review. Merging is a human decision; no agent can merge.`,
        ].join('\n\n'),
      );
      writeState(n, { ...state, humanApprovalFor: head });
    }
  },

  // A new head has no `pipeline/gates` status, which blocks the merge. This
  // gives it a pending one right away so the PR says why it is waiting.
  // approval.yml (workflow_run on CI `requested`); never overwrites.
  'gates-pending'([pr, sha]) {
    const n = num(pr);
    const p = api(`pulls/${n}`);
    if (
      p.state !== 'open' ||
      p.head.sha !== sha ||
      p.head.repo?.full_name !== `${OWNER}/${NAME}`
    ) {
      console.log(
        `gates-pending: skipped (PR #${n} is closed, moved or a fork)`,
      );
      return;
    }
    const statuses = api(`commits/${sha}/statuses?per_page=100`);
    if (statuses.some((s) => s.context === GATES_CONTEXT)) return;
    setGatesStatus(
      sha,
      {
        state: 'pending',
        description: 'Waiting for CI, the Gemini review and the Copilot review',
      },
      statuses,
    );
  },

  // /disposition <finding-id> <kind> <reason> from the pipeline owner
  // (disposition.yml, issue_comment created). The comment arrives through
  // the environment, as data: COMMENT_BODY, COMMENT_USER, COMMENT_USER_TYPE.
  // Invalid commands get one short reply. Valid ones resolve the findings'
  // review threads first and then append one record note each; the notes
  // trigger approval.yml, which re-evaluates the gates.
  disposition([pr, commentId]) {
    const n = num(pr);
    const owner = ownerLogin();
    if (!owner) throw new Error('PIPELINE_OWNER_LOGIN is not set');
    const author = checkDispositionAuthor({
      login: process.env.COMMENT_USER,
      type: process.env.COMMENT_USER_TYPE,
      ownerLogin: owner,
    });
    if (!author.ok) {
      console.log(`disposition: ignored (${author.reason})`);
      return;
    }
    const parsed = parseDispositionComment(process.env.COMMENT_BODY);
    if (parsed.ignore) {
      console.log('disposition: not a command');
      return;
    }
    const reject = (why) => {
      console.log(`disposition: rejected (${why})`);
      postComment(n, `Not recorded: ${why}.`);
    };
    if (!parsed.ok) return reject(parsed.error);
    const p = api(`pulls/${n}`);
    if (p.state !== 'open' || p.head.repo?.full_name !== `${OWNER}/${NAME}`)
      return reject('the pull request is closed or from a fork');
    const bot = botLogin();
    const head = p.head.sha;
    const security = securityIdsForHead({
      comments: list(`issues/${n}/comments`),
      botLogin: bot,
      sha: head,
    });
    const threads = classifyThreads(reviewThreads(n), bot);
    const checked = validateDispositions({
      commands: parsed.commands,
      geminiIds: new Set(security?.ids),
      copilotIds: new Set(
        threads
          .filter((t) => t.source === 'copilot' && !t.thread.isResolved)
          .map((t) => t.id),
      ),
    });
    if (!checked.ok) return reject(checked.error);

    // Resolve first: the record notes are what re-run the gates.
    for (const { id } of parsed.commands)
      for (const t of threads.filter(
        (t) => t.id === id && !t.thread.isResolved,
      ))
        resolveThread(t.thread.id);
    for (const c of parsed.commands)
      postComment(
        n,
        renderDispositionNote({
          ...c,
          head,
          by: process.env.COMMENT_USER,
          commentId: num(commentId),
        }),
      );
    console.log(
      `disposition: recorded ${parsed.commands.map((c) => c.id).join(', ')} at ${head.slice(0, 7)}`,
    );
  },

  // CI failed on a PR (security.yml, workflow_run). Pipeline PRs only:
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
      details: [
        'Push a fix to the branch, or take the PR over by hand. The next green CI run starts the security review again.',
      ],
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
      editLabels(pr, resetFixLoop(labelsOf(pr), 'stage:done'));
    else editLabels(pr, clearStages(labelsOf(pr)));
    for (const i of plan.issues) {
      const n = num(i.number);
      if (i.action === 'done')
        editLabels(n, resetFixLoop(labelsOf(n), 'stage:done'));
      else if (i.action === 'route')
        writeOutcome(n, prClosedOutcome({ pr, closedBy: plan.closedBy }));
    }
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
