// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  parseDispositionComment,
  DISPOSITION_MISPLACED,
  copilotThreadId,
  DISPOSITION_NOT_A_FINDING,
  threadOfComment,
  STAGES,
  shouldMarkReady,
  emptyState,
  evaluateApproval,
  parseFlags,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- disposition: quote reply, threads

const LONG = '/disposition C-100001 accepted-risk The href is a constant.';

test('parseDispositionComment: a quote block above the command is fine', () => {
  const quoted = `> Copilot: unsafe href\n>\n> A user-controlled URL reaches href.\n\n${LONG}`;
  const ok = parseDispositionComment(quoted);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.commands, [
    {
      id: 'C-100001',
      kind: 'accepted-risk',
      reason: 'The href is a constant.',
    },
  ]);
  // CRLF, several quote blocks separated by blank lines, and indentation up to 3.
  assert.equal(
    parseDispositionComment(`> a\r\n\r\n   > b\r\n\r\n${LONG}\r\n`).ok,
    true,
  );
  // More commands after the quote still count, all of them.
  const two = parseDispositionComment(
    `> q\n${LONG}\n/disposition C-12 false-positive Copilot is wrong here.`,
  );
  assert.deepEqual(
    two.commands.map((c) => c.id),
    ['C-100001', 'C-12'],
  );
});

test('parseDispositionComment: a misplaced command is an error, not silence', () => {
  const misplaced = { ok: false, error: DISPOSITION_MISPLACED };
  assert.match(DISPOSITION_MISPLACED, /must be the first thing/);
  assert.match(DISPOSITION_MISPLACED, /quote block above it is fine/);
  assert.match(DISPOSITION_MISPLACED, /Post it again as a new comment/);
  // Prose first, then the command on line 2 (or after a quote and prose).
  assert.deepEqual(
    parseDispositionComment(`Thanks for the review.\n${LONG}`),
    misplaced,
  );
  assert.deepEqual(
    parseDispositionComment(`> quoted\nI agree.\n${LONG}`),
    misplaced,
  );
  // Text on the same line before the command is discussion, not a command.
  assert.deepEqual(parseDispositionComment(`ok: ${LONG}`), {
    ok: false,
    ignore: true,
  });
  // A quote block that is not at the top does not count as one.
  const after = parseDispositionComment(`${LONG}\n> a quote`);
  assert.equal(after.ok, false);
  assert.equal(after.ignore, undefined);
  assert.match(after.error, /^line 2: expected/);
  const middle = parseDispositionComment(
    `${LONG}\n> a quote\n/disposition C-12 false-positive Copilot is wrong here.`,
  );
  assert.equal(middle.ok, false);
  assert.match(middle.error, /^line 2:/);
});

test('parseDispositionComment: mentions are discussion, and quotes alone are nothing', () => {
  for (const text of [
    `Please use \`${LONG}\``,
    `use \`/disposition C-100001 accepted-risk why\` to record it`,
    'the /disposition command is documented',
    '> just a quote\n> of a review',
    `> ${LONG}`,
    `> quoted\n\n> ${LONG}`,
    '`/disposition`',
    'no /dispositions here',
  ])
    assert.deepEqual(
      parseDispositionComment(text),
      { ok: false, ignore: true },
      text,
    );
});

test('parseDispositionComment in a thread: the short form takes its id from the thread', () => {
  const thread = { id: 'C-100001' };
  const ok = parseDispositionComment(
    '/disposition false-positive The value is a static string.',
    { thread },
  );
  assert.deepEqual(ok, {
    ok: true,
    commands: [
      {
        id: 'C-100001',
        kind: 'false-positive',
        reason: 'The value is a static string.',
      },
    ],
  });
  // The long form works when its id is the thread's; a quote block is fine.
  assert.equal(parseDispositionComment(LONG, { thread }).ok, true);
  assert.equal(
    parseDispositionComment(`> quoted\n${LONG}`, { thread }).ok,
    true,
  );
  // A Copilot thread is C-<top comment id>.
  const copilotThread = { id: copilotThreadId(4242) };
  assert.deepEqual(
    parseDispositionComment(
      '/disposition out-of-scope Generated code, not ours.',
      {
        thread: copilotThread,
      },
    ).commands,
    [
      {
        id: 'C-4242',
        kind: 'out-of-scope',
        reason: 'Generated code, not ours.',
      },
    ],
  );
  // The same validation as everywhere else.
  for (const bad of [
    '/disposition false-positive short',
    '/disposition nonsense The value is a static string.',
    '/disposition false-positive',
  ])
    assert.equal(parseDispositionComment(bad, { thread }).ok, false, bad);
});

test('parseDispositionComment in a thread: another finding, one command, no finding', () => {
  const thread = { id: 'C-100001' };
  const other = parseDispositionComment(
    '/disposition C-999999 accepted-risk The href is a constant.',
    { thread },
  );
  assert.deepEqual(other, {
    ok: false,
    error: 'this thread is C-100001; the command names C-999999',
  });
  // Two commands in one thread reply.
  assert.match(
    parseDispositionComment(`${LONG}\n${LONG}`, { thread }).error,
    /one command per reply/,
  );
  // A thread that is not a finding.
  const none = parseDispositionComment(
    '/disposition false-positive The value is a static string.',
    { thread: { id: null } },
  );
  assert.deepEqual(none, { ok: false, error: DISPOSITION_NOT_A_FINDING });
  assert.match(DISPOSITION_NOT_A_FINDING, /use a top-level PR comment/);
  // Discussion in any thread stays discussion, and a misplaced command is still refused.
  for (const t of [thread, { id: null }]) {
    assert.deepEqual(
      parseDispositionComment('looks fine to me', { thread: t }),
      {
        ok: false,
        ignore: true,
      },
    );
    assert.deepEqual(parseDispositionComment(`fine.\n${LONG}`, { thread: t }), {
      ok: false,
      error: DISPOSITION_MISPLACED,
    });
  }
});

test('parseDispositionComment: the short form outside a thread says where it works', () => {
  const r = parseDispositionComment(
    '/disposition false-positive The value is a static string.',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /inside a finding's review thread/);
});

test('parseDispositionComment errors never repeat the comment body', () => {
  for (const body of [
    'secret text\n/disposition C-100001 accepted-risk hunter2 hunter2',
    '/disposition hunter2 accepted-risk hunter2 hunter2 hunter2',
    '/disposition C-100001 nope hunter2 hunter2 hunter2 hunter2',
  ])
    for (const thread of [undefined, { id: 'C-100001' }]) {
      const r = parseDispositionComment(body, { thread });
      assert.equal(r.ok, false);
      assert.ok(!/hunter2|secret text/.test(r.error ?? ''), r.error);
    }
});

test('threadOfComment finds a comment by id, else by the comment it replies to', () => {
  const t = (id, commentIds) => ({ id, thread: { commentIds } });
  const threads = [t('C-11', [11, 12]), t('C-22', [22])];
  assert.equal(threadOfComment(threads, { commentId: 12 }).id, 'C-11');
  assert.equal(threadOfComment(threads, { commentId: 22 }).id, 'C-22');
  // A thread whose comment list was cut short: the reply target locates it.
  assert.equal(
    threadOfComment(threads, { commentId: 99, inReplyTo: 22 }).id,
    'C-22',
  );
  assert.equal(threadOfComment(threads, { commentId: 99 }), null);
  assert.equal(
    threadOfComment(threads, { commentId: 99, inReplyTo: 98 }),
    null,
  );
});

test('workflows: approval.yml evaluates the gates when CI completes green on a same-repo PR', () => {
  const wf = parseYaml(
    readFileSync(new URL('../workflows/approval.yml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(wf.on.workflow_run, {
    workflows: ['CI'],
    types: ['requested', 'completed'],
  });
  assert.ok(!('status' in wf.on));
  for (const part of [
    "github.event.action == 'completed'",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'pull_request'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
  ])
    assert.ok(wf.jobs.resolve.if.includes(part), part);
  const pr = wf.jobs.resolve.steps.find((x) => x.id === 'pr');
  assert.ok(
    pr.env.N.includes('github.event.workflow_run.pull_requests[0].number'),
  );
  // The pending status is for a new head only, not for every CI event.
  assert.ok(wf.jobs.pending.if.includes("github.event.action == 'requested'"));
});

test('workflows: ci-failed.yml only parks pipeline PRs whose CI failed', () => {
  const wf = parseYaml(
    readFileSync(
      new URL('../workflows/ci-failed.yml', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(wf.on.workflow_run, {
    workflows: ['CI'],
    types: ['completed'],
  });
  assert.deepEqual(Object.keys(wf.jobs), ['ci-failed']);
  assert.ok(
    wf.jobs['ci-failed'].if.includes(
      "github.event.workflow_run.conclusion == 'failure'",
    ),
  );
});

test('the agent review and fix stages are gone', () => {
  for (const gone of [
    '../workflows/fix.yml',
    '../workflows/security.yml',
    '../prompts/fix.md',
    '../prompts/security-review.md',
  ])
    assert.throws(() => readFileSync(new URL(gone, import.meta.url)), gone);
  for (const stage of ['stage:reviewing', 'stage:fixing'])
    assert.ok(!STAGES.includes(stage), stage);
});

test('workflows: disposition.yml also listens to review-thread replies, same repo, one queue', () => {
  const src = readFileSync(
    new URL('../workflows/disposition.yml', import.meta.url),
    'utf8',
  );
  const wf = parseYaml(src);
  assert.deepEqual(wf.on.issue_comment.types, ['created']);
  assert.deepEqual(wf.on.pull_request_review_comment.types, ['created']);
  assert.deepEqual(Object.keys(wf.on).sort(), [
    'issue_comment',
    'pull_request_review_comment',
  ]);
  const job = wf.jobs.disposition;
  // Every earlier condition is kept; the script is the real parser.
  for (const needle of [
    "vars.PIPELINE_APP_CLIENT_ID != ''",
    "vars.PIPELINE_BOT_LOGIN != ''",
    "vars.PIPELINE_OWNER_LOGIN != ''",
    'github.event.comment.user.login == vars.PIPELINE_OWNER_LOGIN',
    "github.event.comment.user.type == 'User'",
    "contains(github.event.comment.body, '/disposition')",
    "github.event_name == 'issue_comment' && github.event.issue.pull_request",
    'github.event.pull_request.head.repo.full_name == github.repository',
  ])
    assert.ok(job.if.includes(needle), needle);
  assert.ok(!job.if.includes('startsWith'));
  // One queue per PR for both events, and the event kind reaches the script by env.
  assert.ok(
    job.concurrency.group.includes(
      'github.event.issue.number || github.event.pull_request.number',
    ),
  );
  assert.equal(job.concurrency['cancel-in-progress'], false);
  const step = job.steps.find((x) => x.name === 'Record the disposition');
  assert.match(step.env.COMMENT_KIND, /pull_request_review_comment/);
  assert.match(step.env.COMMENT_KIND, /'review'/);
  assert.match(step.env.N, /github\.event\.pull_request\.number/);
  assert.ok(!step.run.includes('${{'));
});

test("shouldMarkReady: only a draft the pipeline opened is converted, never a person's own", () => {
  assert.equal(shouldMarkReady({ draft: true, pipelinePr: true }), true);
  // A person's draft stays a draft (and the App could not convert it anyway).
  assert.equal(shouldMarkReady({ draft: true, pipelinePr: false }), false);
  assert.equal(shouldMarkReady({ draft: false, pipelinePr: true }), false);
  assert.equal(shouldMarkReady({ draft: false, pipelinePr: false }), false);
  assert.equal(shouldMarkReady({}), false);
});

test("evaluateApproval hands over once per head, whatever the PR's draft state", () => {
  const handed = {
    prState: 'open',
    labels: ['stage:human-approval'],
    headSha: 'h1',
    ciConclusion: 'success',
    unresolvedThreads: 0,
    copilotReviewedHead: false,
    requireCopilot: false,
    state: { ...emptyState(), humanApprovalFor: 'h1' },
  };
  // A person's draft (or a pipeline draft that could not be converted) stays
  // a draft: after the hand-off every later event is a noop, not another note.
  for (const draft of [true, false])
    assert.equal(
      evaluateApproval({ ...handed, draft }).action,
      'noop',
      `draft=${draft}`,
    );
  // A new head is handed over again, and so is a PR that lost its label.
  assert.equal(
    evaluateApproval({ ...handed, draft: true, headSha: 'h2' }).action,
    'human-approval',
  );
  assert.equal(
    evaluateApproval({ ...handed, draft: true, labels: ['stage:building'] })
      .action,
    'human-approval',
  );
});

test('parseFlags: `--key value` and `--key=value` are the same flag', () => {
  assert.deepEqual(parseFlags(['12', '--add', 'a', '--remove=b']), {
    _: ['12'],
    add: 'a',
    remove: 'b',
  });
});

test('parseFlags: repeated flags collect, values keep their own "="', () => {
  const f = parseFlags([
    '--context',
    'k=v',
    '--context=issue=7',
    '--context',
    'x=',
  ]);
  assert.deepEqual(f.context, ['k=v', 'issue=7', 'x=']);
});

test('parseFlags: `--key=value` does not swallow the next argument', () => {
  const f = parseFlags(['--branch=pipeline/1', '55']);
  assert.equal(f.branch, 'pipeline/1');
  assert.deepEqual(f._, ['55']);
});
