// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  checkCoexistence,
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
    /runs on a push of the engine's issue-7-probe branch/,
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
