// Run: pnpm test:pipeline
// connector-coexistence.mjs: workflow-level concurrency, pushes to issue-*
// branches, and label conditions that only look like stage filters. The
// check is a review aid, not a guarantee: it reads workflow files and can
// miss what they do at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  checkCoexistence,
  filtersStageLabels,
  readWorkflowFolder,
} from './connector-coexistence.mjs';

const connector = readWorkflowFolder(
  fileURLToPath(
    new URL(
      '../../connectors/pipeline-sandbox/.github/workflows/',
      import.meta.url,
    ),
  ),
);
const conflictsOf = (workflow) =>
  checkCoexistence({ ...connector, 'other.yml': workflow }).errors;
const job = (extra = {}) => ({
  'runs-on': 'ubuntu-latest',
  steps: [],
  ...extra,
});

test("concurrency: a workflow-level group like the engine's is a conflict", () => {
  const workflowLevel = {
    on: 'workflow_dispatch',
    concurrency: {
      group: 'pipeline-engine-${{ github.repository }}-7-develop',
      'cancel-in-progress': true,
    },
    jobs: { build: job() },
  };
  assert.match(
    conflictsOf(workflowLevel).join(),
    /shares the engine's concurrency groups/,
  );
  assert.match(
    conflictsOf({ ...workflowLevel, concurrency: 'pipeline-engine-x' }).join(),
    /concurrency groups/,
  );
  assert.deepEqual(
    conflictsOf({ ...workflowLevel, concurrency: 'ci-${{ github.ref }}' }),
    [],
  );
});

test('push: a workflow that pushes to issue-* branches is a conflict', () => {
  const runPush = {
    on: 'workflow_dispatch',
    jobs: {
      sync: job({ steps: [{ run: 'git push origin HEAD:issue-7-fix' }] }),
    },
  };
  assert.match(conflictsOf(runPush).join(), /pushes to issue-<n>-\* branches/);
  const claudePrefix = {
    on: { issue_comment: { types: ['created'] } },
    jobs: {
      claude: job({
        steps: [
          {
            uses: 'anthropics/claude-code-action@v1',
            with: { branch_prefix: 'issue-' },
          },
        ],
      }),
    },
  };
  assert.match(
    conflictsOf(claudePrefix).join(),
    /pushes to issue-<n>-\* branches/,
  );
  const createPullRequest = {
    on: 'workflow_dispatch',
    jobs: {
      pr: job({
        steps: [
          {
            uses: 'peter-evans/create-pull-request@v7',
            with: { branch: 'issue-9-update' },
          },
        ],
      }),
    },
  };
  assert.match(
    conflictsOf(createPullRequest).join(),
    /pushes to issue-<n>-\* branches/,
  );
  const glob = {
    on: { push: { branches: ['issue-**'] } },
    jobs: { build: job() },
  };
  assert.match(
    conflictsOf(glob).join(),
    /runs on a push of an engine issue-<n>-\* branch/,
  );
  // pushing elsewhere, or the default claude/ prefix, is fine
  const elsewhere = {
    on: 'workflow_dispatch',
    jobs: {
      sync: job({
        steps: [
          { run: 'git push origin HEAD:main' },
          {
            uses: 'anthropics/claude-code-action@v1',
            with: { branch_prefix: 'claude/' },
          },
        ],
      }),
    },
  };
  assert.deepEqual(conflictsOf(elsewhere), []);
});

test("labels: `!= 'bug'` and negated groups do not filter the stage labels", () => {
  for (const condition of [
    "github.event.label.name != 'bug'",
    "!(github.event.label.name == 'bug')",
    "!(!startsWith(github.event.label.name, 'stage:'))",
    "github.event.label.name == 'STAGE:planned'",
    "github.event.label.name == 'bug' || github.event.label.name == 'stage:planned'",
    "contains(github.event.label.name, 'bug')",
  ])
    assert.equal(filtersStageLabels(condition), false, condition);
  for (const condition of [
    "github.event.label.name == 'bug'",
    "'bug' == github.event.label.name",
    "(github.event.label.name == 'bug') && github.actor != 'x'",
    "${{ !startsWith(github.event.label.name, 'Stage:') }}",
  ])
    assert.equal(filtersStageLabels(condition), true, condition);
  const notBug = {
    on: { issues: { types: ['labeled'] } },
    jobs: { triage: job({ if: "github.event.label.name != 'bug'" }) },
  };
  assert.match(conflictsOf(notBug).join(), /runs on issue label changes/);
});
