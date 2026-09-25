#!/usr/bin/env node
// Deterministic pipeline steps, called from .github/workflows/*.yml.
// Usage: node .github/scripts/pipeline.mjs <command> [args...]
import { readFileSync, writeFileSync } from 'node:fs';
import {
  COPILOT_LOGINS,
  COPILOT_REVIEWER,
  GATES_CONTEXT,
  MARKERS,
  MAX_LIFETIME_RESETS,
  PROTECTED_CONTEXT,
  STAGE_STATUS,
  allowedTargets,
  applyLabels,
  branchIssueEligible,
  branchName,
  buildSecurityReview,
  clearStages,
  checkDispositionAuthor,
  checkPatch,
  classifyPatch,
  classifyThreads,
  classifyDevelop,
  classifyFix,
  classifyPlan,
  collectRouterInput,
  decideCiFailed,
  decideFix,
  decideFixRetry,
  decideProtectedCommand,
  decideRestart,
  decideRestartHint,
  dispositionKinds,
  dispositionsInEffect,
  emptyState,
  evaluateApproval,
  evaluateProtectedApproval,
  isGeminiBillingError,
  isPipelinePr,
  isPipelineBranch,
  issueForAgents,
  issueFromBranch,
  latestProtectedRequest,
  needsProtectedRequest,
  normalizeOutcome,
  parseDispositionComment,
  parseDispositionNotes,
  parseProtectedApprovedNotes,
  parseRequireCopilot,
  parseSecurityReport,
  parseState,
  patchNewLines,
  planPrClosed,
  planRoute,
  prClosedOutcome,
  previewUrl,
  promptVersion,
  protectedOfCompare,
  renderApprovedPrBody,
  renderDispositionNote,
  renderGatesComment,
  renderOutcome,
  renderPlanComment,
  renderProtectedApprovedNote,
  renderProtectedRequest,
  renderRestartHint,
  renderPrompt,
  renderSpecComment,
  renderState,
  resetFixItems,
  resetFixLoop,
  routerSkip,
  sameLogin,
  securityIdsForHead,
  securityOutcomeDetails,
  securitySkippedForHead,
  securitySkippedOutcome,
  selectActionable,
  shouldMarkReady,
  stageTransition,
  threadOfComment,
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

/** `vars.REQUIRE_COPILOT`: only the exact string `true` turns the gate on. */
const requireCopilot = () => parseRequireCopilot(process.env.REQUIRE_COPILOT);

function writeState(pr, state, labels = labelsOf(pr)) {
  upsertBotComment(
    pr,
    MARKERS.state,
    renderState(state, labels, { requireCopilot: requireCopilot() }),
  );
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
 * With `{ route: false }` a problem sets no stage either: for the one
 * problem that parks the item for a person (`protected_approval_needed`).
 */
function writeOutcome(number, input, { route = true } = {}) {
  const outcome = normalizeOutcome({
    ...input,
    run_url: input.run_url || runUrl(),
    item: number,
  });
  postComment(number, renderOutcome(outcome));
  if (route) {
    if (outcome.result === 'problem') setStage(number, 'stage:routing');
  }
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
function setStatus(context, sha, { state, description }, statuses) {
  const current = statuses.find((s) => s.context === context);
  const text = description.slice(0, 140);
  if (current?.state === state && current.description === text) return;
  api(`statuses/${sha}`, {
    method: 'POST',
    body: { state, context, description: text },
  });
}

const setGatesStatus = (sha, gates, statuses) =>
  setStatus(GATES_CONTEXT, sha, gates, statuses);

// ------------------------------------------------------------ protected approval

const defaultBranch = () =>
  process.env.DEFAULT_BRANCH || api('').default_branch;

/** Files of `base...head` (the compare API lists at most 300; see comparePaths). */
const compareFiles = (base, head) =>
  api(`compare/${base}...${head}`).files ?? [];

/** Bot text for a comment: no pings, no pipeline markers. */
const say = (text) =>
  String(text)
    .replace(/<!--/g, '&lt;!--')
    .replace(/@/g, `@${String.fromCharCode(0x200b)}`)
    .slice(0, 500);

/**
 * The `pipeline/protected-approval` evaluation of an open same-repo PR:
 * recomputed from the changed files and the bot's approval records, never
 * read back from a status.
 */
function protectedEvaluation(p, comments) {
  const pipelinePr = isPipelinePr({
    author: p.user?.login,
    headRef: p.head?.ref,
    headRepo: p.head?.repo?.full_name,
    repo: `${OWNER}/${NAME}`,
    botLogin: botLogin(),
  });
  const files = pipelinePr ? compareFiles(defaultBranch(), p.head.sha) : [];
  return {
    ...evaluateProtectedApproval({
      pipelinePr,
      head: p.head.sha,
      files,
      notes: parseProtectedApprovedNotes(comments, botLogin()),
      ownerLogin: ownerLogin(),
    }),
    pipelinePr,
    files,
  };
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
      patchProtected: f['patch-protected'],
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

  // Exit 1 unless the patch touches no protected path. `--accept approvable`
  // also passes a patch whose protected paths are all approvable (only
  // develop.yml's implement job, which then asks the owner); `--expect
  // none|approvable` requires exactly that kind (the publish job checks
  // again what implement saw). Outputs `protected` (none | approvable |
  // forbidden) and `protected_paths`.
  'check-patch'(args) {
    const f = flags(args);
    const res = classifyPatch(readFileSync(f._[0], 'utf8'));
    setOutput('protected', res.kind);
    setOutput('protected_paths', res.protected.join('\n'));
    const expect = f.expect ?? null;
    if (expect !== null && !['none', 'approvable'].includes(expect))
      throw new Error(`Bad --expect ${expect}`);
    const accepted = expect
      ? [expect]
      : f.accept === 'approvable'
        ? ['none', 'approvable']
        : ['none'];
    if (res.protected.length)
      (accepted.includes(res.kind) ? console.log : console.error)(
        `Patch touches protected paths (${res.kind}): ${res.protected.join(', ')}`,
      );
    for (const e of res.errors) console.error(`Patch rejected: ${e}`);
    if (!accepted.includes(res.kind)) process.exit(1);
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
      ownerLogin: ownerLogin(),
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

  // Did the Gemini CLI fail with the API's 402 (credits depleted)? Reads the
  // CLI's stderr the action left in the workspace and sets the `billing`
  // output. No file, or any other text, is `false`. The file is capped and
  // only searched for one fixed string; nothing from it is executed.
  'gemini-billing'([file]) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8').slice(0, 1_000_000);
    } catch {
      // no stderr recorded: not a billing failure
    }
    setOutput('billing', String(isGeminiBillingError(text)));
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
    // Gemini answered 402 (credit used up): release the PR to human approval
    // with a loud note instead of failing the review. Only when the review
    // job says so (security.yml matches the API's exact 402 message); any
    // other failure still ends in the fail-closed path below. The note is
    // written before the status, because the status is what re-runs approval.
    if (
      process.env.REVIEW_RESULT !== 'success' &&
      process.env.REVIEW_BILLING === 'true'
    ) {
      writeOutcome(n, securitySkippedOutcome({ sha, promptVer }));
      setStage(n, 'stage:reviewing');
      status(
        'success',
        'SKIPPED: Gemini credits depleted (402), no review ran',
      );
      setOutput('skipped', 'billing');
      console.log(`Security review of ${sha.slice(0, 7)} skipped: Gemini 402.`);
      return;
    }
    // Finding ids anchor on a code line the reviewer quotes; parseSecurityReport
    // checks that it is a line of the file at the reviewed head. Only files the
    // PR changed are read (the path comes from reviewer output). The file's
    // content at `sha` is the source; the PR patch (added and context lines)
    // is the fallback when it cannot be read.
    const files = list(`pulls/${n}/files`);
    const lineCache = new Map();
    const readLines = (file) => {
      if (lineCache.has(file)) return lineCache.get(file);
      const changed = files.find(
        (f) => f.filename === file && f.status !== 'removed',
      );
      let lines = null;
      if (changed) {
        try {
          const c = api(`contents/${encodeURI(file)}?ref=${sha}`);
          if (c?.encoding === 'base64' && typeof c.content === 'string')
            lines = Buffer.from(c.content, 'base64')
              .toString('utf8')
              .split(/\r?\n/);
        } catch {
          // fall back to the patch
        }
        lines ??= changed.patch ? patchNewLines(changed.patch) : null;
      }
      lineCache.set(file, lines);
      return lines;
    };
    const report = parseSecurityReport(readFileSync(responseFile, 'utf8'), {
      readLines,
    });
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
      files,
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
    // Recomputed from the changed files and the approval records, so a push
    // after the approval is pending again whatever the status says.
    const protectedEval = protectedEvaluation(p, comments);
    setStatus(PROTECTED_CONTEXT, head, protectedEval, statuses);
    const records = parseDispositionNotes(comments, bot);
    const kinds = dispositionKinds({ records, ownerLogin: ownerLogin() });
    const securityFindings = securityIdsForHead({
      comments,
      botLogin: bot,
      sha: head,
    });
    const securitySkipped = securitySkippedForHead({
      comments,
      botLogin: bot,
      sha: head,
    });
    const decision = evaluateApproval({
      prState: p.state,
      labels,
      headSha: head,
      ciConclusion: conclusionOf('ci') ?? null,
      securityJobConclusion: conclusionOf('security'),
      securityState: stateOf('pipeline/security'),
      securityFindings,
      securitySkipped,
      dispositioned: new Set(kinds.keys()),
      unresolvedThreads: threads.filter((t) => !t.isResolved).length,
      copilotReviewedHead,
      requireCopilot: requireCopilot(),
      protectedRequired: protectedEval.required,
      protectedApprovalState: protectedEval.state,
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
      // Only for the PRs the pipeline opened as drafts. A failure here must
      // not end the hand-off: the outcome and label are written already, and
      // the comment and state below are what keep it from repeating.
      let stillDraft = false;
      if (
        shouldMarkReady({
          draft: p.draft,
          pipelinePr: protectedEval.pipelinePr,
        })
      )
        try {
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
        } catch (e) {
          console.error(`approval: could not mark #${n} ready: ${e.message}`);
          stillDraft = true;
        }
      const url = previewUrl(OWNER, NAME, n);
      upsertBotComment(
        n,
        MARKERS.humanApproval,
        [
          `### Ready for human approval`,
          securitySkipped
            ? `**WARNING: the Gemini security review did NOT run on \`${head.slice(0, 7)}\`.** The Gemini API answered 402 (credits depleted). Renew the Google Gemini subscription or credits, and read this change yourself before approving. (To get the review afterwards, re-run the failed **Pipeline · Security Review** run for this commit.)`
            : '',
          `CI is green, ${securitySkipped ? '' : 'the Gemini security review is clean or every finding is dispositioned, '}${requireCopilot() ? `Copilot has reviewed \`${head.slice(0, 7)}\`, ` : ''}all threads are resolved and \`${GATES_CONTEXT}\` is green.`,
          `**Preview:** ${url}`,
          `Code owners have been requested for review. Merging is a human decision; no agent can merge.`,
          stillDraft
            ? 'The pull request is still a draft: the pipeline could not mark it ready for review. Mark it ready yourself.'
            : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
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
        description: requireCopilot()
          ? 'Waiting for CI, the Gemini review and the Copilot review'
          : 'Waiting for CI and the Gemini review',
      },
      statuses,
    );
  },

  // /disposition from the pipeline owner (disposition.yml): a top-level PR
  // comment or quote reply (issue_comment created) or a reply inside a
  // finding's review thread (pull_request_review_comment created,
  // COMMENT_KIND=review). The comment arrives through the environment, as
  // data: COMMENT_BODY, COMMENT_USER, COMMENT_USER_TYPE. Invalid commands get
  // one short reply, in the thread for a thread reply. Valid ones resolve the
  // findings' review threads first and then append one record note per
  // finding to the PR conversation; the notes trigger approval.yml, which
  // re-evaluates the gates.
  disposition([pr, commentId]) {
    const n = num(pr);
    const cid = num(commentId);
    const inThread = process.env.COMMENT_KIND === 'review';
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
    let parsed = parseDispositionComment(process.env.COMMENT_BODY);
    if (parsed.ignore) {
      console.log('disposition: not a command');
      return;
    }
    const bot = botLogin();
    let threads = null;
    // Where the answer goes: the thread for a thread reply, else the PR.
    let replyTo = null;
    if (inThread) {
      threads = classifyThreads(reviewThreads(n), bot);
      const c = api(`pulls/comments/${cid}`);
      const entry = threadOfComment(threads, {
        commentId: cid,
        inReplyTo: c.in_reply_to_id,
      });
      replyTo = entry?.thread.first?.id ?? c.in_reply_to_id ?? cid;
      parsed = parseDispositionComment(process.env.COMMENT_BODY, {
        thread: { id: entry?.id ?? null },
      });
    }
    const tell = (text) => {
      if (!inThread) return postComment(n, text);
      try {
        return api(`pulls/${n}/comments/${replyTo}/replies`, {
          method: 'POST',
          body: { body: `${MARKERS.dispositionReply}\n${text}` },
        });
      } catch (e) {
        console.error(e.stack ?? e);
        return postComment(n, text);
      }
    };
    const reject = (why) => {
      console.log(`disposition: rejected (${why})`);
      tell(`Not recorded: ${why}.`);
    };
    if (!parsed.ok) return reject(parsed.error);
    const p = api(`pulls/${n}`);
    if (p.state !== 'open' || p.head.repo?.full_name !== `${OWNER}/${NAME}`)
      return reject('the pull request is closed or from a fork');
    const head = p.head.sha;
    const security = securityIdsForHead({
      comments: list(`issues/${n}/comments`),
      botLogin: bot,
      sha: head,
    });
    threads ??= classifyThreads(reviewThreads(n), bot);
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

    // Validation passed: a failure from here on must not leave the owner
    // without any reply. Tell them once, then fail the job.
    let noteUrl = null;
    try {
      // Resolve first: the record notes are what re-run the gates.
      for (const { id } of parsed.commands)
        for (const t of threads.filter(
          (t) => t.id === id && !t.thread.isResolved,
        ))
          resolveThread(t.thread.id);
      for (const c of parsed.commands) {
        const note = postComment(
          n,
          renderDispositionNote({
            ...c,
            head,
            by: process.env.COMMENT_USER,
            commentId: cid,
          }),
        );
        noteUrl ??= note?.html_url ?? null;
      }
    } catch (e) {
      const url = runUrl();
      try {
        tell(
          `Not recorded: the bot hit an error${url ? `; see ${url}` : ''}. Nothing was changed; post the command again after a fix.`,
        );
      } catch (postError) {
        console.error(postError.stack ?? postError);
      }
      throw e;
    }
    console.log(
      `disposition: recorded ${parsed.commands.map((c) => c.id).join(', ')} at ${head.slice(0, 7)}`,
    );
    if (inThread) {
      // The record is written; a failed courtesy reply must not undo it.
      try {
        tell(`Recorded${noteUrl ? `: see ${noteUrl}` : ''}.`);
      } catch (e) {
        console.error(e.stack ?? e);
      }
    }
  },

  // The owner's /restart <stage> <reason> on an ISSUE (restart.yml,
  // issue_comment created). The comment arrives through the environment, as
  // data: COMMENT_BODY, COMMENT_USER, COMMENT_USER_TYPE. decideRestart
  // checks everything; a comment that cannot be honoured gets one short
  // reply and changes nothing. Accepted: the issue's lifetime counter and
  // attempt list are written FIRST (a crash after that costs a restart,
  // never gives one away), then the restart route note lands on the item
  // that restarts and its stage label is applied. For `fixing` that item is
  // the linked open PR, and `fix_pr` asks restart.yml to run Pipeline · Fix.
  restart([number, commentId]) {
    const n = num(number);
    const cid = num(commentId);
    const item = api(`issues/${n}`);
    const fetched = api(`issues/comments/${cid}`);
    const repo = `${OWNER}/${NAME}`;
    const pullRequests = list('pulls?state=open')
      .filter(
        (p) =>
          isPipelinePr({
            author: p.user?.login,
            headRef: p.head?.ref,
            headRepo: p.head?.repo?.full_name,
            repo,
            botLogin: botLogin(),
          }) &&
          issueFromBranch({
            headRef: p.head.ref,
            headRepo: p.head.repo?.full_name,
            repo,
          }) === n,
      )
      .map((p) => ({ number: p.number, labels: p.labels.map((l) => l.name) }));
    const labels = item.labels.map((l) => l.name);
    const decision = decideRestart({
      comment: {
        id: cid,
        body: process.env.COMMENT_BODY,
        login: process.env.COMMENT_USER,
        type: process.env.COMMENT_USER_TYPE,
        createdAt: fetched.created_at,
      },
      ownerLogin: ownerLogin(),
      edited:
        fetched.updated_at !== fetched.created_at ||
        fetched.body !== process.env.COMMENT_BODY,
      issue: {
        number: n,
        state: item.state,
        isPullRequest: Boolean(item.pull_request),
        labels,
      },
      state: readState(n),
      pullRequests,
    });
    console.log(
      `restart: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );
    if (decision.action === 'ignore') return;
    if (decision.action === 'reply') {
      postComment(
        n,
        decision.limit
          ? decision.reason
          : `Not applied: ${say(decision.reason)}.`,
      );
      return;
    }

    const { target } = decision;
    writeState(
      n,
      decision.state,
      target.kind === 'issue' ? applyLabels(labels, target.edit) : labels,
    );
    postComment(target.number, decision.note);
    editLabels(target.number, target.edit);
    if (target.kind === 'pr') {
      // A round that failed before pushing left its items marked handled:
      // forget them, or the run below finds no new feedback and does nothing.
      writeState(target.number, resetFixItems(readState(target.number)));
      postComment(
        n,
        `Restart ${decision.count}/${MAX_LIFETIME_RESETS} accepted: the fix loop of PR #${target.number} has a fresh budget and Pipeline · Fix runs next.`,
      );
      setOutput('fix_pr', String(target.number));
    }
  },

  // A person moved an item out of stage:needs-attention by hand (restart.yml,
  // label event by a human): one pointer to /restart per parking. The label
  // edit already happened and stays; this changes no budget. EVENT_ACTION
  // and LABEL come from the event, through the environment.
  'restart-hint'([number]) {
    const n = num(number);
    const item = api(`issues/${n}`);
    if (item.state !== 'open') {
      console.log(`restart-hint: skipped (#${n} is closed)`);
      return;
    }
    const decision = decideRestartHint({
      action: process.env.EVENT_ACTION,
      label: process.env.LABEL,
      labels: item.labels.map((l) => l.name),
      comments: list(`issues/${n}/comments`),
      botLogin: botLogin(),
    });
    console.log(
      `restart-hint: ${decision.post ? 'posting' : `skipped (${decision.reason})`}`,
    );
    if (decision.post) postComment(n, renderRestartHint());
  },

  // develop.yml publish job, approvable case. The branch is already pushed
  // and NO PR exists: the protected content has not run anywhere. Posts the
  // approval request on the issue (protected paths with their full diff),
  // appends a `protected_approval_needed` outcome note and parks the issue
  // in stage:awaiting-approval. A branch that turns out to hold a
  // never-approvable path (or a file list that may be cut off) is deleted
  // and the step fails with `rejected=true` (the forbidden_path hard gate).
  'protected-request'(args) {
    const f = flags(args);
    const n = num(f._[0]);
    const branch = f.branch;
    if (!isPipelineBranch(branch)) throw new Error('Not a pipeline branch');
    const base = defaultBranch();
    const head = api(`git/ref/heads/${branch}`).object.sha;
    const files = compareFiles(base, head);
    const changed = protectedOfCompare(files);
    if (
      !changed.complete ||
      changed.never.length ||
      !changed.protected.length
    ) {
      console.error(
        `protected-request: refused (never approvable: ${changed.never.join(', ') || '-'}; complete: ${changed.complete}; protected: ${changed.protected.length})`,
      );
      try {
        api(`git/refs/heads/${branch}`, { method: 'DELETE' });
      } catch {
        // already gone
      }
      setOutput('rejected', 'true');
      process.exit(1);
    }
    let result = {};
    try {
      result = JSON.parse(readIf(f.result) || '{}');
    } catch {
      result = {};
    }
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    postComment(
      n,
      renderProtectedRequest({
        head,
        branch,
        compareUrl: `${server}/${OWNER}/${NAME}/compare/${base}...${branch}`,
        files,
        title: result.pr_title,
        body: result.pr_body,
      }),
    );
    writeOutcome(
      n,
      {
        stage: 'develop',
        result: 'problem',
        problem: 'protected_approval_needed',
        summary: `Branch ${branch} pushed at ${head.slice(0, 7)} without a PR: ${changed.protected.length} protected path(s) need the owner's approval.`,
        details: [
          `Protected paths: ${changed.protected.join(', ')}`,
          `The owner replies on this issue with /approve-protected ${head.slice(0, 12)} (or /reject-protected <reason>).`,
        ],
        prompt_version: f['prompt-version'] ?? '',
      },
      { route: false },
    );
    setStage(n, 'stage:awaiting-approval');
    setOutput('head', head);
  },

  // The owner's /approve-protected or /reject-protected on an issue
  // (protected-approve.yml, issue_comment created). The comment arrives
  // through the environment, as data: COMMENT_BODY, COMMENT_USER,
  // COMMENT_USER_TYPE. decideProtectedCommand checks everything; a comment
  // that cannot be honoured gets one short reply and changes nothing.
  // Approve: opens the PR (or, if one is already open for the branch,
  // records the approval on it), appends the record note, sets
  // `pipeline/protected-approval` = success and the issue's stage:building.
  // Reject: a `protected_rejected` outcome (the router hands it to a human);
  // the branch stays.
  'protected-decision'([number, commentId]) {
    const n = num(number);
    const cid = num(commentId);
    const bot = botLogin();
    const owner = ownerLogin();
    const item = api(`issues/${n}`);
    const fetched = api(`issues/comments/${cid}`);
    const refs = list(`git/matching-refs/heads/issue-${n}-`);
    const request = latestProtectedRequest(list(`issues/${n}/comments`), bot);
    const base = defaultBranch();
    let changed = null;
    if (request) {
      try {
        changed = protectedOfCompare(compareFiles(base, request.head));
      } catch {
        changed = null; // the commit is gone: decideProtectedCommand refuses
      }
    }
    const by = process.env.COMMENT_USER;
    const decision = decideProtectedCommand({
      comment: {
        body: process.env.COMMENT_BODY,
        login: by,
        type: process.env.COMMENT_USER_TYPE,
      },
      ownerLogin: owner,
      edited:
        fetched.updated_at !== fetched.created_at ||
        fetched.body !== process.env.COMMENT_BODY,
      issue: {
        state: item.state,
        isPullRequest: Boolean(item.pull_request),
        labels: item.labels.map((l) => l.name),
      },
      request,
      branchHeads: refs.map((r) => r.object.sha),
      changed,
    });
    console.log(
      `protected-decision: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );
    if (decision.action === 'ignore') return;
    if (decision.action === 'reply') {
      postComment(n, `Not applied: ${say(decision.reason)}.`);
      return;
    }
    if (decision.action === 'reject') {
      writeOutcome(n, {
        stage: 'develop',
        result: 'problem',
        problem: 'protected_rejected',
        summary: `The owner rejected the protected changes at ${decision.head.slice(0, 7)}.`,
        details: [
          `Reason: ${decision.reason}`,
          'The branch is kept; nothing was merged and no PR was opened.',
        ],
      });
      return;
    }

    // approve
    const { head } = decision;
    const branch = refs
      .find((r) => r.object.sha === head)
      .ref.replace(/^refs\/heads\//, '');
    let pr = list('pulls?state=open').find(
      (x) =>
        x.head.ref === branch && x.head.repo?.full_name === `${OWNER}/${NAME}`,
    );
    if (!pr) {
      pr = api('pulls', {
        method: 'POST',
        body: {
          title: (request.pr?.title || `Issue #${n}`).slice(0, 250),
          head: branch,
          base,
          draft: true,
          body: renderApprovedPrBody({
            body: request.pr?.body,
            issue: n,
            protectedPaths: decision.protectedPaths,
            head,
            by,
          }),
        },
      });
      if (!findBotComment(pr.number, MARKERS.state))
        writeState(pr.number, { ...emptyState(), watermark: pr.created_at });
      setStage(pr.number, 'stage:building');
    }
    // The note before the status: gates recompute from the notes.
    postComment(
      pr.number,
      renderProtectedApprovedNote({
        issue: n,
        pr: pr.number,
        head,
        paths: decision.paths,
        by,
        commentId: cid,
        protectedPaths: decision.protectedPaths,
      }),
    );
    setStatus(
      PROTECTED_CONTEXT,
      head,
      { state: 'success', description: `Approved by @${by}` },
      api(`commits/${head}/statuses?per_page=100`),
    );
    setStage(n, 'stage:building');
    postComment(
      n,
      `Approved by @${say(by)} for \`${head.slice(0, 7)}\`. PR #${pr.number} carries the protected changes; CI and the review gates run next.`,
    );
    setOutput('pr', String(pr.number));
  },

  // A pipeline PR's `pipeline/protected-approval` status, recomputed
  // (protected-approve.yml, workflow_run on CI `requested`: every new head).
  // Success when the PR has no protected path or the latest approval record
  // names this head and path set; pending otherwise, and then a new
  // approval request is posted on the issue for this head (unless the latest
  // request is already for it) and the issue returns to
  // stage:awaiting-approval.
  'protected-status'([pr, sha]) {
    const n = num(pr);
    const p = api(`pulls/${n}`);
    if (
      p.state !== 'open' ||
      p.head.sha !== sha ||
      p.head.repo?.full_name !== `${OWNER}/${NAME}`
    ) {
      console.log(
        `protected-status: skipped (PR #${n} is closed, moved or a fork)`,
      );
      return;
    }
    const head = p.head.sha;
    const evaluation = protectedEvaluation(p, list(`issues/${n}/comments`));
    console.log(
      `protected-status: ${evaluation.state} (${evaluation.description})`,
    );
    setStatus(
      PROTECTED_CONTEXT,
      head,
      evaluation,
      api(`commits/${head}/statuses?per_page=100`),
    );
    const issue = issueFromBranch({
      headRef: p.head.ref,
      headRepo: p.head.repo?.full_name,
      repo: `${OWNER}/${NAME}`,
    });
    if (!issue || !evaluation.pipelinePr) return;
    const request = latestProtectedRequest(
      list(`issues/${issue}/comments`),
      botLogin(),
    );
    if (!needsProtectedRequest({ evaluation, request, head })) return;
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    postComment(
      issue,
      renderProtectedRequest({
        head,
        branch: p.head.ref,
        compareUrl: `${server}/${OWNER}/${NAME}/compare/${defaultBranch()}...${head}`,
        files: evaluation.files,
        title: p.title,
        body: '',
      }),
    );
    writeOutcome(
      issue,
      {
        stage: 'approval',
        result: 'problem',
        problem: 'protected_approval_needed',
        summary: `PR #${n} has a new commit ${head.slice(0, 7)} with protected changes: owner approval needed.`,
        details: [
          `Protected paths: ${evaluation.paths.join(', ')}`,
          `The owner replies on issue #${issue} with /approve-protected ${head.slice(0, 12)} (or /reject-protected <reason>).`,
        ],
      },
      { route: false },
    );
    setStage(issue, 'stage:awaiting-approval');
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
