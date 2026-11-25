// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  routeWindow,
  planRoute,
  collectRouterInput,
  MARKERS,
  decideRestartHint,
  renderRestartHint,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  BOT,
  note,
  outcomeNote,
  restart,
  routeNote,
} from './pipeline-lib-fixtures.mjs';

test('routeWindow: only a restart opens a window', () => {
  const r = (target) => ({ target });
  const targets = (routes) => routeWindow(routes).map((x) => x.target);
  assert.deepEqual(routeWindow(), []);
  assert.deepEqual(routeWindow([]), []);
  // no restart on record: every counted route stays in the window
  assert.deepEqual(targets([r('replan'), r('redevelop')]), [
    'replan',
    'redevelop',
  ]);
  // a restart opens a window: only what comes after it counts
  assert.deepEqual(
    targets([r('replan'), r('replan'), r('restart'), r('redevelop')]),
    ['redevelop'],
  );
  assert.deepEqual(targets([r('replan'), r('restart')]), []);
  // a manual label removal writes no note, so it changes nothing: a route
  // to a human neither opens a window nor counts as a round
  assert.deepEqual(targets([r('replan'), r('replan'), r('human')]), [
    'replan',
    'replan',
  ]);
  // a human route AFTER a restart does not close or reopen anything
  assert.deepEqual(
    targets([r('replan'), r('restart'), r('redevelop'), r('human')]),
    ['redevelop'],
  );
  assert.deepEqual(targets([r('replan'), r('restart'), r('human')]), []);
  // several restarts: the latest one counts
  assert.deepEqual(
    targets([
      r('replan'),
      r('restart'),
      r('replan'),
      r('human'),
      r('restart'),
      r('redevelop'),
      r('restart'),
      r('replan'),
      r('retry'),
    ]),
    ['replan', 'retry'],
  );
});

test('scenario: a hand move keeps the used budget, /restart gives a fresh one', () => {
  const comments = [];
  const bad = ['plan', 'invalid_output'];
  const step = () => {
    comments.push(outcomeNote(...bad));
    const r = planRoute({ comments, botLogin: BOT });
    comments.push(note(r.body));
    return r;
  };
  assert.equal(step().final.target, 'replan'); // round 1
  assert.equal(step().final.target, 'replan'); // round 2 (cap)
  const parked = step();
  assert.equal(parked.final.target, 'human');
  assert.match(parked.final.reason, /cap is reached \(2\/2\)/);
  // A person removes the label or re-adds a stage by hand: no note, so the
  // next problem still meets the spent budget and goes straight back.
  const again = step();
  assert.equal(again.final.target, 'human');
  assert.match(again.final.reason, /cap is reached \(2\/2\)/);
  assert.equal(again.stage, 'stage:needs-attention');
  // The owner's /restart: the note is not a route (it does not make the
  // outcome look routed) and the window starts after it.
  const restartNote = restart(
    '/restart qualified answered every question',
  ).note;
  comments.push(note(restartNote));
  const fresh = step();
  assert.equal(fresh.final.target, 'replan');
  assert.equal(fresh.final.round, 1);
  // the human hand-off after the restart lists only rounds since it
  assert.equal(step().final.target, 'replan');
  const parkedAgain = step();
  assert.equal(parkedAgain.final.target, 'human');
  assert.match(parkedAgain.body, /Round 1:/);
  assert.match(parkedAgain.body, /Round 2:/);
  assert.doesNotMatch(parkedAgain.body, /Round 3:/);
  assert.match(parkedAgain.body, /Only \/restart opens a fresh loop budget/);
  // still parked: a person's label edit again changes nothing
  assert.equal(step().final.target, 'human');
});

test('collectRouterInput reads restart notes only from the bot', () => {
  const restartNote = restart(
    '/restart planned the plan was fixed by hand',
  ).note;
  const comments = [
    outcomeNote('plan', 'invalid_output'),
    note(restartNote, 'mallory'),
    routeNote('replan'),
    note(restartNote),
    outcomeNote('plan', 'invalid_output'),
  ];
  const { history, error } = collectRouterInput({ comments, botLogin: BOT });
  assert.equal(error, null);
  assert.deepEqual(
    history.routes.map((r) => r.target),
    ['replan', 'restart'],
  );
  // a restart note after the latest outcome does not hide it from the router
  const after = collectRouterInput({
    comments: [outcomeNote('plan', 'invalid_output'), note(restartNote)],
    botLogin: BOT,
  });
  assert.equal(after.error, null);
});

test('decideRestartHint: one pointer per parking, humans only reach it by hand', () => {
  const humanRoute = note(
    '<!-- pipeline:route target=human round=0 -->\n**Routed to a human**',
  );
  const hint = note(`${MARKERS.restartHint}\n\ntext`);
  const decide = (input) =>
    decideRestartHint({ botLogin: BOT, comments: [], ...input });
  // removed by hand
  assert.equal(
    decide({ action: 'unlabeled', label: 'stage:needs-attention', labels: [] })
      .post,
    true,
  );
  assert.equal(
    decide({
      action: 'unlabeled',
      label: 'stage:needs-attention',
      labels: ['stage:qualified'],
    }).post,
    true,
  );
  // put back at once, or some other label removed: nothing
  assert.equal(
    decide({
      action: 'unlabeled',
      label: 'stage:needs-attention',
      labels: ['stage:needs-attention'],
    }).post,
    false,
  );
  assert.equal(
    decide({ action: 'unlabeled', label: 'stage:qualified', labels: [] }).post,
    false,
  );
  // a stage label added by hand while still parked
  assert.equal(
    decide({
      action: 'labeled',
      label: 'stage:qualified',
      labels: ['stage:needs-attention', 'stage:qualified'],
    }).post,
    true,
  );
  // ...but a normal label on an item that is not parked is just triage
  assert.equal(
    decide({
      action: 'labeled',
      label: 'stage:qualified',
      labels: ['stage:qualified'],
    }).post,
    false,
  );
  for (const label of [
    'stage:routing',
    'stage:done',
    'bug',
    'stage:needs-attention',
  ])
    assert.equal(
      decide({
        action: 'labeled',
        label,
        labels: ['stage:needs-attention', label],
      }).post,
      false,
      label,
    );
  assert.equal(
    decide({ action: 'opened', label: 'x', labels: [] }).post,
    false,
  );
  // once: after a pointer for this parking, none; a new parking gets one
  const removed = {
    action: 'unlabeled',
    label: 'stage:needs-attention',
    labels: [],
  };
  assert.equal(decide({ ...removed, comments: [humanRoute] }).post, true);
  assert.equal(
    decide({ ...removed, comments: [humanRoute, hint] }).post,
    false,
  );
  assert.equal(decide({ ...removed, comments: [hint] }).post, false);
  assert.equal(
    decide({ ...removed, comments: [humanRoute, hint, humanRoute] }).post,
    true,
  );
  // a pointer forged by someone else counts for nothing
  assert.equal(
    decide({
      ...removed,
      comments: [humanRoute, note(`${MARKERS.restartHint}\nx`, 'mallory')],
    }).post,
    true,
  );
  const text = renderRestartHint();
  assert.match(text, /\/restart <qualified\|planned>/);
  assert.match(text, /3 restarts/);
  assert.ok(text.startsWith(MARKERS.restartHint));
});

// Expressions a `run:` script must never expand (template injection, which
// zizmor also flags): pass them through `env:` instead.
const RUN_FORBIDDEN = [
  /\binputs\./,
  /\bgithub\.event\.inputs\./,
  /\bgithub\.event\.comment\.body\b/,
];

function runExpansions(wf) {
  const found = [];
  for (const [jobName, job] of Object.entries(wf.jobs ?? {}))
    for (const [i, step] of (job.steps ?? []).entries()) {
      if (typeof step.run !== 'string') continue;
      for (const [, expr] of step.run.matchAll(/\$\{\{([\s\S]*?)\}\}/g))
        if (RUN_FORBIDDEN.some((bad) => bad.test(expr)))
          found.push(`job ${jobName} step ${i + 1}: ${expr.trim()}`);
    }
  return found;
}

test('guard: no workflow expands inputs.* or the comment body inside run:', () => {
  const dir = new URL('../workflows/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.includes('restart.yml'));
  for (const file of files)
    assert.deepEqual(
      runExpansions(parseYaml(readFileSync(new URL(file, dir), 'utf8'))),
      [],
      `${file}: pass these through env: instead of expanding them in run:`,
    );
  // the guard catches what it is for, and lets env-passed values through
  const wf = (run, env) =>
    parseYaml(
      `jobs:\n  j:\n    steps:\n      - run: ${JSON.stringify(run)}\n        env: ${JSON.stringify(env ?? {})}`,
    );
  assert.equal(runExpansions(wf('echo ${{ inputs.pr }}')).length, 1);
  assert.equal(
    runExpansions(wf('echo "${{github.event.inputs.pr}}"')).length,
    1,
  );
  assert.equal(
    runExpansions(wf('echo ${{ github.event.comment.body }}')).length,
    1,
  );
  assert.equal(
    runExpansions(wf('echo "$PR"', { PR: '${{ inputs.pr }}' })).length,
    0,
  );
  assert.equal(
    runExpansions(wf('echo ${{ github.event.issue.number }}')).length,
    0,
  );
});

test('restart.yml: owner command, env-only inputs, fail-closed conditions', () => {
  const wf = parseYaml(
    readFileSync(new URL('../workflows/restart.yml', import.meta.url), 'utf8'),
  );
  const on = wf.on ?? wf[true];
  assert.deepEqual(on.issue_comment.types, ['created']);
  assert.equal(
    wf.permissions !== undefined && Object.keys(wf.permissions).length,
    0,
  );
  const restartIf = wf.jobs.restart.if;
  // fails closed without an owner, only humans, only issues, only the command
  for (const part of [
    "vars.PIPELINE_OWNER_LOGIN != ''",
    "vars.PIPELINE_BOT_LOGIN != ''",
    '!github.event.issue.pull_request',
    "github.event.comment.user.type == 'User'",
    "startsWith(github.event.comment.body, '/restart')",
  ])
    assert.ok(restartIf.includes(part), part);
  const step = wf.jobs.restart.steps.find((s) => s.id === 'restart');
  assert.equal(
    step.run,
    'node .github/scripts/pipeline.mjs restart "$N" "$COMMENT_ID"',
  );
  assert.ok(step.env.COMMENT_BODY.includes('github.event.comment.body'));
  // the label-event job only reacts to people, never to the pipeline's bot
  assert.ok(wf.jobs.hint.if.includes("github.event.sender.type == 'User'"));
  // every downstream label event uses a token that triggers workflows
  assert.ok(wf.jobs.restart.steps.some((s) => s.id === 'app'));
});
