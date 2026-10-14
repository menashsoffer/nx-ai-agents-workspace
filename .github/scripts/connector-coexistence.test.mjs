// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  candidateOf,
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

/** The standard @claude workflow of anthropics/claude-code-action. */
const directClaude = (overrides = {}) => ({
  name: 'Claude Code',
  on: {
    issue_comment: { types: ['created'] },
    pull_request_review_comment: { types: ['created'] },
    issues: { types: ['opened', 'assigned'] },
    pull_request_review: { types: ['submitted'] },
  },
  jobs: {
    claude: {
      if: "contains(github.event.comment.body, '@claude')",
      'runs-on': 'ubuntu-latest',
      permissions: {
        contents: 'write',
        'pull-requests': 'write',
        issues: 'write',
        'id-token': 'write',
      },
      steps: [
        { uses: 'actions/checkout@v4' },
        {
          uses: 'anthropics/claude-code-action@v1',
          with: {
            claude_code_oauth_token: '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
          },
        },
      ],
    },
  },
  ...overrides,
});

/** The standard automatic review workflow (read-only, pull requests). */
const directReview = {
  on: { pull_request: { types: ['opened', 'synchronize'] } },
  jobs: {
    review: {
      permissions: { contents: 'read', 'pull-requests': 'read' },
      steps: [{ uses: 'anthropics/claude-code-action@v1' }],
    },
  },
};

test('the connector alone coexists with nothing', () => {
  assert.deepEqual(checkCoexistence(connector), { errors: [], warnings: [] });
});

test('the standard direct Claude workflows: no conflict, two decisions for a person', () => {
  const { errors, warnings } = checkCoexistence({
    ...connector,
    'claude.yml': directClaude(),
    'claude-code-review.yml': directReview,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.length, 2);
  assert.match(
    warnings[0],
    /claude\.yml: a direct Claude job can push branches/,
  );
  assert.match(
    warnings[1],
    /claude\.yml: a direct Claude job also answers on pipeline issues/,
  );
});

test('conflicts: label triggers, engine branch pushes, the App key, inherited secrets', () => {
  const conflicts = (workflow) =>
    checkCoexistence({ ...connector, 'claude.yml': workflow }).errors;
  assert.match(
    conflicts(
      directClaude({ on: { issues: { types: ['opened', 'labeled'] } } }),
    ).join(),
    /runs on issue label changes/,
  );
  assert.match(
    conflicts(directClaude({ on: 'issues' })).join(),
    /runs on issue label changes/,
  );
  assert.match(
    conflicts(directClaude({ on: { push: { branches: ['**'] } } })).join(),
    /runs on a push of an engine issue-<n>-\* branch/,
  );
  assert.deepEqual(
    conflicts(directClaude({ on: { push: { branches: ['main'] } } })),
    [],
  );
  const withKey = directClaude();
  withKey.jobs.claude.env = { KEY: '${{ secrets.PIPELINE_APP_PRIVATE_KEY }}' };
  assert.match(
    conflicts(withKey).join(),
    /reads the pipeline App's private key/,
  );
  const inherit = {
    on: 'workflow_dispatch',
    jobs: {
      call: { uses: 'x/y/.github/workflows/z.yml@main', secrets: 'inherit' },
    },
  };
  assert.match(conflicts(inherit).join(), /secrets: inherit/);
  const shared = directClaude();
  shared.jobs.claude.concurrency = { group: 'pipeline-engine-x' };
  assert.match(conflicts(shared).join(), /concurrency groups/);
});

test('a missing connector workflow is an error', () => {
  const { errors } = checkCoexistence({ 'claude.yml': directClaude() });
  assert.deepEqual(errors.slice(0, 2), [
    'pipeline-develop.yml: the connector workflow is missing',
    'pipeline-plan.yml: the connector workflow is missing',
  ]);
});

test('label triggers that filter out the stage labels are no conflict', () => {
  const onLabels = (...conditions) => ({
    on: { issues: { types: ['labeled'] } },
    jobs: Object.fromEntries(
      conditions.map((condition, index) => [
        `job${index}`,
        { if: condition, steps: [] },
      ]),
    ),
  });
  const conflicts = (workflow) =>
    checkCoexistence({ ...connector, 'triage.yml': workflow }).errors;
  for (const condition of [
    "${{ !startsWith(github.event.label.name, 'stage:') }}",
    "github.event.label.name == 'bug' && github.actor != 'x'",
    "github.event.action != 'labeled'",
  ]) {
    assert.ok(filtersStageLabels(condition), condition);
    assert.deepEqual(conflicts(onLabels(condition)), [], condition);
  }
  for (const condition of [
    undefined,
    "github.event.label.name == 'stage:planned'",
    "!startsWith(github.event.label.name, 'stage:') || true",
    "contains(github.event.label.name, 'bug')",
  ])
    assert.equal(filtersStageLabels(condition), false, String(condition));
  // every job must filter: one unfiltered job is enough for a conflict
  assert.match(
    conflicts(
      onLabels(
        "!startsWith(github.event.label.name, 'stage:')",
        "github.event.issue.state == 'open'",
      ),
    ).join(),
    /no job filters them out/,
  );
  assert.match(conflicts(onLabels()).join(), /runs on issue label changes/);
});

test('before copying: the candidate is the existing workflows plus the connector', () => {
  const existing = {
    'claude.yml': directClaude(),
    'claude-code-review.yml': directReview,
  };
  const candidate = candidateOf(existing, connector);
  assert.deepEqual(candidate.errors, []);
  assert.deepEqual(Object.keys(candidate.workflows).sort(), [
    'claude-code-review.yml',
    'claude.yml',
    'pipeline-develop.yml',
    'pipeline-plan.yml',
  ]);
  assert.deepEqual(checkCoexistence(candidate.workflows).errors, []);
  // an existing file of the same name would be overwritten
  const clash = candidateOf({ 'pipeline-plan.yml': directClaude() }, connector);
  assert.deepEqual(clash.errors, [
    "pipeline-plan.yml: an existing workflow would be overwritten by the connector's",
  ]);
  // the same connector file already installed is no clash
  assert.deepEqual(candidateOf(connector, connector).errors, []);
});

test('the CLI checks a candidate before copying', () => {
  const existingFolder = mkdtempSync(join(tmpdir(), 'existing-workflows-'));
  const connectorFolder = fileURLToPath(
    new URL(
      '../../connectors/pipeline-sandbox/.github/workflows/',
      import.meta.url,
    ),
  );
  const script = fileURLToPath(
    new URL('./connector-coexistence.mjs', import.meta.url),
  );
  const check = () =>
    spawnSync(
      process.execPath,
      [script, '--existing', existingFolder, '--connector', connectorFolder],
      { encoding: 'utf8' },
    );
  writeFileSync(
    join(existingFolder, 'claude.yml'),
    JSON.stringify(directClaude()),
  );
  const clean = check();
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(
    clean.stdout,
    /warning: claude\.yml: a direct Claude job can push branches/,
  );
  writeFileSync(
    join(existingFolder, 'labels.yml'),
    JSON.stringify(directClaude({ on: { issues: { types: ['labeled'] } } })),
  );
  const conflict = check();
  assert.equal(conflict.status, 1);
  assert.match(
    conflict.stdout,
    /error: labels\.yml: runs on issue label changes/,
  );
});
