// Shared fixtures for the pipeline-lib tests. Not a test file.
import {
  normalizeOutcome,
  renderOutcome,
  renderRoute,
  decideRestart,
} from './pipeline-lib.mjs';

// Hunks below are real `git diff` output (default core.quotePath=true).
export const hunk = '@@ -0,0 +1 @@\n+x\n';

export const BOT = 'pipeline[bot]';

export const alice = { login: 'alice', type: 'User' };

export const bot = { login: BOT, type: 'Bot' };

// ---------------------------------------------------------------- router
export const RUN = 'https://github.com/o/r/actions/runs/42';

export const problem = (stage, p, extra = {}) =>
  normalizeOutcome({
    stage,
    result: 'problem',
    problem: p,
    run_url: RUN,
    item: 7,
    ...extra,
  });

export const note = (body, login = BOT) => ({ user: { login }, body });

export const outcomeNote = (stage, p, extra) =>
  note(renderOutcome({ stage, result: 'problem', problem: p, ...extra }));

export const routeNote = (target, round = 1, extra = {}) =>
  note(
    renderRoute({
      final: { target, reason: 'r', questions: [], round, cap: 2 },
      outcome: problem(
        extra.stage ?? 'plan',
        extra.problem ?? 'spec_questions',
      ),
      mode: 'rules',
    }),
  );

// A well-formed, approvable planner result (the JSON plan.yml's schema yields).
export const planned = (over = {}) => ({
  status: 'planned',
  problem: 'none',
  questions: [],
  details: [],
  signals: { embedded_instructions: false, needs_secrets_ci_infra: false },
  spec: {
    goal: 'Show a banner on the home page.',
    acceptance_criteria: [
      {
        text: 'Given the home page, then the banner is visible.',
        testable: true,
      },
      { text: 'Given RTL, the banner mirrors.', testable: true },
    ],
    rtl_accessibility: 'Logical utilities; Hebrew copy; role=status.',
    test_plan: 'Vitest for the component; Playwright for `/`.',
    out_of_scope: 'Dismissal.',
    assumptions: 'None.',
  },
  plan: {
    approach: 'Add a Banner to libs/ui and use it on the home page.',
    changes: [
      {
        project: 'ui',
        file: 'libs/ui/src/lib/banner/banner.tsx',
        change: 'new',
        lines: 40,
      },
      {
        project: 'site',
        file: 'apps/site/src/pages/home.tsx',
        change: 'use it',
        lines: 10,
      },
    ],
    tests: 'Criterion 1 -> banner.spec.tsx; criterion 2 -> home.spec.tsx.',
    risks: 'RTL mirroring.',
    definition_of_done: '`pnpm verify` passes.',
  },
  ...over,
});

export const withPlan = (patch) =>
  planned({ plan: { ...planned().plan, ...patch } });

export const withSpec = (patch) =>
  planned({ spec: { ...planned().spec, ...patch } });

export const filesOf = (n, lines = 1) =>
  Array.from({ length: n }, (_, i) => ({
    project: 'site',
    file: `apps/site/src/f${i}.ts`,
    change: 'x',
    lines,
  }));

// ---------------------------------------------------------------- gates
export const HEAD_A = 'a'.repeat(40);

export const HEAD_B = 'b'.repeat(40);

export const OWNER_LOGIN = 'menashsoffer';

// The Copilot gate is on for the existing gate tests; the `gate off` tests
// below use `off` (REQUIRE_COPILOT unset).
export const passing = {
  ciConclusion: 'success',
  unresolvedThreads: 0,
  copilotReviewedHead: true,
  requireCopilot: true,
};

// ---------------------------------------------------------------- protected approval
export const PA = 'a'.repeat(40);

export const PB = 'b'.repeat(40);

export const PKG = 'apps/site/package.json';

export const LOCK = 'pnpm-lock.yaml';

export const cf = (filename, extra = {}) => ({
  filename,
  status: 'modified',
  additions: 3,
  deletions: 1,
  patch: `@@ -1 +1,3 @@\n-old ${filename}\n+new ${filename}`,
  ...extra,
});

// The compare response's files for a branch that adds a dependency.
export const depFiles = () => [
  cf(PKG),
  cf(LOCK, { patch: '@@ -1 +1 @@\n-x\n+y' }),
  cf('apps/site/src/app.tsx'),
];

// ---------------------------------------------------------------- restart
export const RESTART_OWNER = 'menashsoffer';

export const parkedIssue = (labels = ['stage:needs-attention']) => ({
  number: 7,
  state: 'open',
  isPullRequest: false,
  labels,
});

const restartComment = (body, extra = {}) => ({
  id: 555,
  body,
  login: RESTART_OWNER,
  type: 'User',
  createdAt: '2026-02-01T10:00:00Z',
  ...extra,
});

export const restart = (body, input = {}) =>
  decideRestart({
    comment: restartComment(body, input.comment),
    ownerLogin: RESTART_OWNER,
    issue: parkedIssue(),
    ...input,
    // a plain override of `comment` would drop the defaults above
    ...(input.comment ? { comment: restartComment(body, input.comment) } : {}),
  });
