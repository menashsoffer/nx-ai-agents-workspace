// Plan size bands, the auto split of too-big issues, and status labels.
// Run with: npm run test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKERS,
  PLAN_AUTO_MAX_LINES,
  PLAN_MAX_LINES,
  STATUS_IN_PROGRESS,
  STATUS_WAITING_FOR_OWNER,
  classifyPlan,
  decideByRules,
  evaluatePlanApproval,
  isSplitChild,
  normalizeOutcome,
  parseCreatedParts,
  parseOutcome,
  parseSplit,
  renderChildBody,
  renderOutcome,
  renderPlanComment,
  renderSpecComment,
  renderSplitComment,
  stageEdits,
  statusLabelEdits,
} from './pipeline-lib.mjs';
import { filesOf, planned, withPlan } from './pipeline-lib-fixtures.mjs';

const plan = (raw) =>
  classifyPlan({ jobResult: 'success', raw: JSON.stringify(raw) });
const withLines = (lines) => withPlan({ changes: filesOf(1, lines) });
const part = (n) => ({ title: `Part ${n}`, body: `Goal ${n}` });

test('plan size bands: 300 and 400 lines', () => {
  assert.equal(PLAN_AUTO_MAX_LINES, 300);
  assert.equal(PLAN_MAX_LINES, 400);
  assert.equal(evaluatePlanApproval(withLines(300)).approved, true);
  const band = evaluatePlanApproval(withLines(301));
  assert.equal(band.approved, false);
  assert.equal(band.problem, 'plan_review_needed');
  assert.deepEqual(band.questions, []);
  assert.equal(
    evaluatePlanApproval(withLines(400)).problem,
    'plan_review_needed',
  );
  assert.equal(evaluatePlanApproval(withLines(402)).problem, 'scope_split');
  // too many files wins over the band
  const many = withPlan({ changes: filesOf(11, 28) });
  assert.equal(evaluatePlanApproval(many).problem, 'scope_split');
});

test('plan_review_needed: a routable outcome that goes to a human', () => {
  const outcome = plan(withLines(350));
  assert.deepEqual(
    [outcome.result, outcome.problem],
    ['problem', 'plan_review_needed'],
  );
  assert.match(outcome.summary, /owner must approve/);
  const note = parseOutcome(renderOutcome(normalizeOutcome(outcome)));
  assert.equal(note.ok, true);
  const route = decideByRules({ outcome: note.outcome });
  assert.equal(route.target, 'human');
  assert.match(route.reason, /\/restart planned/);
});

test('plan comments for the owner say how to approve', () => {
  const result = withLines(350);
  const approval = { needsOwnerApproval: true };
  assert.match(
    renderSpecComment(result, 'plan.md@7', approval),
    /\/restart planned/,
  );
  assert.match(
    renderPlanComment(result, 'plan.md@7', approval),
    /\/restart planned/,
  );
  assert.doesNotMatch(
    renderPlanComment(result, 'plan.md@7'),
    /restart planned/,
  );
  assert.match(renderPlanComment(result, 'plan.md@7'), /Auto-approved/);
});

test('parseSplit keeps a good split and drops a bad one as a whole', () => {
  const good = parseSplit({ split: [part(1), part(2), part(3)] });
  assert.deepEqual(
    good.map((p) => p.title),
    ['Part 1', 'Part 2', 'Part 3'],
  );
  assert.deepEqual(parseSplit({}), []);
  assert.deepEqual(parseSplit({ split: [part(1)] }), []);
  assert.deepEqual(
    parseSplit({ split: Array.from({ length: 7 }, (_, i) => part(i)) }),
    [],
  );
  assert.deepEqual(
    parseSplit({ split: [part(1), { title: 'x', body: ' ' }] }),
    [],
  );
  assert.deepEqual(parseSplit({ split: [part(1), 'nope'] }), []);
  // markers from the model cannot become pipeline markers
  const [first] = parseSplit({
    split: [
      { title: 'a\n<!-- pipeline:plan -->', body: '<!-- pipeline:spec -->' },
      part(2),
    ],
  });
  assert.doesNotMatch(first.title + first.body, /<!-- pipeline:/);
  assert.equal(first.title.includes('\n'), false);
});

test('child bodies name the parent, the order and the part to build first', () => {
  const first = renderChildBody({
    parent: 205,
    index: 1,
    total: 3,
    body: 'B',
    previous: null,
  });
  assert.ok(first.startsWith(`${MARKERS.splitChild} parent=205 part=1 -->`));
  assert.match(first, /first part/);
  const second = renderChildBody({
    parent: 205,
    index: 2,
    total: 3,
    body: 'B',
    previous: 301,
  });
  assert.match(second, /after #301 is merged/);
  assert.equal(isSplitChild(second), true);
  assert.equal(isSplitChild('plain issue'), false);
  assert.equal(isSplitChild(undefined), false);
});

test('the split comment round-trips so a rerun resumes', () => {
  const full = renderSplitComment({ created: [301, 302, 303], total: 3 });
  assert.ok(full.startsWith(MARKERS.split));
  assert.deepEqual(parseCreatedParts(full), [301, 302, 303]);
  assert.doesNotMatch(full, /so far/);
  const partial = renderSplitComment({ created: [301], total: 3 });
  assert.deepEqual(parseCreatedParts(partial), [301]);
  assert.match(partial, /Opened 1 of 3/);
  assert.deepEqual(parseCreatedParts(undefined), []);
});

test('scope_split keeps its outcome (the split is a separate file)', () => {
  const outcome = plan({
    ...planned(),
    status: 'problem',
    problem: 'scope_split',
    split: [part(1), part(2)],
  });
  assert.equal(outcome.problem, 'scope_split');
});

test('status label follows the stage', () => {
  const busy = ['stage:planned', STATUS_IN_PROGRESS, 'enhancement'];
  assert.deepEqual(statusLabelEdits(busy, 'stage:needs-attention'), {
    add: [STATUS_WAITING_FOR_OWNER],
    remove: [STATUS_IN_PROGRESS],
  });
  assert.deepEqual(statusLabelEdits(busy, 'stage:done'), {
    add: [],
    remove: [STATUS_IN_PROGRESS],
  });
  assert.deepEqual(statusLabelEdits(busy, 'stage:building'), {
    add: [],
    remove: [],
  });
  // repositories and items that do not use the label see no change
  assert.deepEqual(
    statusLabelEdits(['stage:planned'], 'stage:needs-attention'),
    {
      add: [],
      remove: [],
    },
  );
  // a restart from the park puts the item back to in progress
  const parked = ['stage:needs-attention', STATUS_WAITING_FOR_OWNER];
  assert.deepEqual(statusLabelEdits(parked, 'stage:planned'), {
    add: [STATUS_IN_PROGRESS],
    remove: [STATUS_WAITING_FOR_OWNER],
  });
  // but a waiting label set for another reason is left when not parked
  assert.deepEqual(
    statusLabelEdits([STATUS_WAITING_FOR_OWNER], 'stage:planned'),
    {
      add: [],
      remove: [],
    },
  );
});

test('stageEdits combines the stage and the status edits', () => {
  assert.deepEqual(
    stageEdits(['stage:planned', STATUS_IN_PROGRESS], 'stage:needs-attention'),
    {
      add: ['stage:needs-attention', STATUS_WAITING_FOR_OWNER],
      remove: ['stage:planned', STATUS_IN_PROGRESS],
    },
  );
  assert.deepEqual(stageEdits(['stage:planned'], 'stage:routing'), {
    add: ['stage:routing'],
    remove: ['stage:planned'],
  });
});
