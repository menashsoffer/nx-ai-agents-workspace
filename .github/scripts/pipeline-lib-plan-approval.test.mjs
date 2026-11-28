// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  evaluatePlanApproval,
  PLAN_AUTO_MAX_LINES,
  PLAN_MAX_FILES,
  PLAN_MAX_LINES,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import {
  filesOf,
  planned,
  withPlan,
  withSpec,
} from './pipeline-lib-fixtures.mjs';

test('auto-approval: a complete, small, in-scope result is approved', () => {
  const ev = evaluatePlanApproval(planned());
  assert.deepEqual(ev, {
    approved: true,
    files: [
      'libs/ui/src/lib/banner/banner.tsx',
      'apps/site/src/pages/home.tsx',
    ],
    lines: 50,
  });
  assert.equal(PLAN_MAX_FILES, 10);
  assert.equal(PLAN_MAX_LINES, 400);
});

test('auto-approval: schema failures are invalid_output (re-plan)', () => {
  const bad = (r, re) => {
    const ev = evaluatePlanApproval(r);
    assert.equal(ev.approved, false);
    assert.equal(ev.problem, 'invalid_output');
    assert.ok(
      ev.details.some((d) => re.test(d)),
      ev.details.join('|'),
    );
  };
  bad({ ...planned(), spec: undefined }, /`spec` is missing/);
  bad({ ...planned(), plan: undefined }, /`plan` is missing/);
  bad({ ...planned(), signals: undefined }, /`signals`/);
  for (const f of [
    'goal',
    'rtl_accessibility',
    'test_plan',
    'out_of_scope',
    'assumptions',
  ])
    bad(withSpec({ [f]: '  ' }), new RegExp(`spec\\.${f}`));
  for (const f of ['approach', 'tests', 'risks', 'definition_of_done'])
    bad(withPlan({ [f]: '' }), new RegExp(`plan\\.${f}`));
  bad(withSpec({ acceptance_criteria: [] }), /no criteria/);
  bad(
    withSpec({ acceptance_criteria: [{ text: '  ', testable: true }] }),
    /criterion 1 is empty/,
  );
  bad(withSpec({ acceptance_criteria: [{ text: 'x' }] }), /no testable flag/);
  bad(withPlan({ changes: [] }), /lists no files/);
  bad(
    withPlan({ changes: [{ project: 'ui', file: '', change: 'x', lines: 1 }] }),
    /valid repo-relative file/,
  );
  bad(
    withPlan({
      changes: [{ project: 'ui', file: '../x', change: 'x', lines: 1 }],
    }),
    /valid repo-relative file/,
  );
  bad(
    withPlan({
      changes: [{ project: 'ui', file: '/etc/x', change: 'x', lines: 1 }],
    }),
    /valid repo-relative file/,
  );
  bad(
    withPlan({ changes: [{ project: 'ui', file: 'a.ts', change: 'x' }] }),
    /line count/,
  );
  bad(
    withPlan({
      changes: [{ project: 'ui', file: 'a.ts', change: 'x', lines: -1 }],
    }),
    /line count/,
  );
  assert.equal(evaluatePlanApproval(null).problem, 'invalid_output');
});

test('auto-approval: every criterion must be marked testable', () => {
  const ev = evaluatePlanApproval(
    withSpec({
      acceptance_criteria: [
        { text: 'Fine.', testable: true },
        { text: 'It feels modern.', testable: false },
      ],
    }),
  );
  assert.equal(ev.problem, 'spec_questions');
  assert.match(ev.details[0], /criterion 2 is not testable: It feels modern\./);
  assert.equal(ev.questions.length, 1);
});

test('auto-approval: planned never-approvable paths are protected_surface', () => {
  for (const file of [
    '.github/workflows/ci.yml',
    './.github/prompts/plan.md',
    '.GITHUB/workflows/x.yml',
    'tools/security/src/run.mjs',
    'CODEOWNERS',
    '.claude/settings.json',
    '.npmrc',
    'apps/site/.gitmodules',
    '.pipeline/x.json',
  ]) {
    const ev = evaluatePlanApproval(
      withPlan({
        changes: [{ project: 'x', file, change: 'edit', lines: 1 }],
      }),
    );
    assert.equal(ev.problem, 'protected_surface', file);
    assert.match(ev.details.join(' '), /protected paths/);
  }
  // near misses are fine
  assert.equal(
    evaluatePlanApproval(
      withPlan({
        changes: [
          {
            project: 'site',
            file: 'apps/site/src/package.json.ts',
            change: 'x',
            lines: 1,
          },
          {
            project: 'docs',
            file: 'docs/github/notes.md',
            change: 'x',
            lines: 1,
          },
        ],
      }),
    ).approved,
    true,
  );
});

test('auto-approval: secrets/CI/infra and embedded instructions are reported', () => {
  const signals = (o) => ({
    signals: {
      embedded_instructions: false,
      needs_secrets_ci_infra: false,
      ...o,
    },
  });
  const infra = evaluatePlanApproval(
    planned(signals({ needs_secrets_ci_infra: true })),
  );
  assert.equal(infra.problem, 'needs_secrets_ci_infra');
  const inj = evaluatePlanApproval(
    planned(signals({ embedded_instructions: true })),
  );
  assert.equal(inj.problem, 'embedded_instructions');
  // gates outrank every other failure, even an incomplete result
  const both = evaluatePlanApproval({
    ...planned(
      signals({ embedded_instructions: true, needs_secrets_ci_infra: true }),
    ),
    spec: undefined,
  });
  assert.equal(both.problem, 'embedded_instructions');
  assert.ok(both.details.length >= 3, 'all failures are listed');
  // ...and a protected path outranks size and testability
  const mixed = evaluatePlanApproval(
    withPlan({
      changes: [
        ...filesOf(11),
        { project: 'x', file: '.github/x.yml', change: 'edit', lines: 1 },
      ],
    }),
  );
  assert.equal(mixed.problem, 'protected_surface');
});

test('auto-approval: size limits are scope_split, both thresholds inclusive', () => {
  const at = (n, lines) =>
    evaluatePlanApproval(withPlan({ changes: filesOf(n, lines) }));
  assert.equal(at(PLAN_MAX_FILES, 1).approved, true, 'exactly the file limit');
  const tooManyFiles = at(PLAN_MAX_FILES + 1, 1);
  assert.equal(tooManyFiles.problem, 'scope_split');
  assert.match(tooManyFiles.details[0], /11 files \(limit 10\)/);
  // 4 files x 75 lines = exactly the auto-approval line limit
  assert.equal(
    at(4, PLAN_AUTO_MAX_LINES / 4).approved,
    true,
    'exactly the auto-approval line limit',
  );
  // 4 files x 76 lines = 304: a sound plan the owner must approve
  const needsOwner = at(4, PLAN_AUTO_MAX_LINES / 4 + 1);
  assert.equal(needsOwner.problem, 'plan_review_needed');
  assert.match(needsOwner.details[0], /304 changed lines/);
  // 4 files x 100 lines = exactly the hard line limit
  assert.equal(
    at(4, PLAN_MAX_LINES / 4).problem,
    'plan_review_needed',
    'exactly the hard line limit',
  );
  const tooManyLines = at(4, PLAN_MAX_LINES / 4 + 1);
  assert.equal(tooManyLines.problem, 'scope_split');
  assert.match(tooManyLines.details[0], /404 changed lines \(limit 400\)/);
  // the same file listed twice counts once
  const dup = evaluatePlanApproval(
    withPlan({
      changes: [
        ...filesOf(PLAN_MAX_FILES),
        {
          project: 'site',
          file: './apps/site/src/f0.ts',
          change: 'again',
          lines: 1,
        },
      ],
    }),
  );
  assert.equal(dup.approved, true);
  // limits are tunable per call
  assert.equal(
    evaluatePlanApproval(planned(), { maxFiles: 1 }).problem,
    'scope_split',
  );
  assert.equal(
    evaluatePlanApproval(planned(), { maxLines: 49, autoMaxLines: 49 }).problem,
    'scope_split',
  );
  assert.equal(
    evaluatePlanApproval(planned(), { autoMaxLines: 49 }).problem,
    'plan_review_needed',
  );
  assert.equal(
    evaluatePlanApproval(planned(), { autoMaxLines: 50 }).approved,
    true,
  );
});
