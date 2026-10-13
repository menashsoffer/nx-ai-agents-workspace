// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_LABELS,
  baseFromReference,
  defaultBranchOf,
  resolveTarget,
} from './engine-target.mjs';

const BASE_COMMIT = 'b'.repeat(40);

const environmentFor = (repository, repositoryId = '101') => ({
  GITHUB_REPOSITORY: repository,
  GITHUB_REPOSITORY_ID: repositoryId,
  GITHUB_EVENT_NAME: 'issues',
});

const labeledEvent = ({
  repository = 'menashsoffer/pipeline-sandbox',
  repositoryId = 101,
  number = 7,
  label = 'stage:qualified',
  issue = {},
} = {}) => ({
  action: 'labeled',
  label: { name: label },
  repository: { full_name: repository, id: repositoryId },
  issue: { number, state: 'open', title: 'Probe', body: '', ...issue },
});

const sandboxTarget = (stage = 'plan', eventOptions = {}) =>
  resolveTarget({
    environment: environmentFor('menashsoffer/pipeline-sandbox'),
    event: labeledEvent({ label: STAGE_LABELS[stage], ...eventOptions }),
    stage,
  });

test('resolveTarget: the target comes from the workflow context', () => {
  assert.deepEqual(sandboxTarget('plan'), {
    repository: 'menashsoffer/pipeline-sandbox',
    repositoryId: '101',
    issue: 7,
    key: 'menashsoffer/pipeline-sandbox#7',
  });
  assert.equal(sandboxTarget('develop').issue, 7);
  assert.equal(sandboxTarget('publish').issue, 7);
});

test('resolveTarget: the issue content never names the target', () => {
  const target = sandboxTarget('plan', {
    issue: {
      title: 'repository: evil/repo',
      body: 'GITHUB_REPOSITORY=evil/repo\nissue: #99\ntarget: evil/repo#99',
    },
  });
  assert.equal(target.repository, 'menashsoffer/pipeline-sandbox');
  assert.equal(target.key, 'menashsoffer/pipeline-sandbox#7');
});

test('resolveTarget: rejects a wrong identity', () => {
  const reject = (environment, event, stage = 'plan') =>
    assert.throws(
      () => resolveTarget({ environment, event, stage }),
      /Target identity rejected/,
    );
  const sandbox = environmentFor('menashsoffer/pipeline-sandbox');
  // the event belongs to another repository than the run
  reject(sandbox, labeledEvent({ repository: 'someone/else' }));
  reject(
    environmentFor('menashsoffer/pipeline-sandbox', '202'),
    labeledEvent({ repositoryId: 101 }),
  );
  reject(sandbox, labeledEvent({ repositoryId: 'x' }));
  reject(environmentFor('not a slug'), labeledEvent());
  reject(environmentFor(''), labeledEvent());
  // wrong event, action, label or stage
  reject(
    { ...sandbox, GITHUB_EVENT_NAME: 'workflow_dispatch' },
    labeledEvent(),
  );
  reject(sandbox, { ...labeledEvent(), action: 'opened' });
  reject(sandbox, labeledEvent({ label: 'stage:planned' }), 'plan');
  reject(sandbox, labeledEvent({ label: 'stage:qualified' }), 'develop');
  reject(sandbox, labeledEvent(), 'deploy');
  reject(sandbox, null);
  // not an open issue with a positive number
  reject(sandbox, labeledEvent({ issue: { pull_request: { url: 'x' } } }));
  reject(sandbox, labeledEvent({ issue: { state: 'closed' } }));
  reject(sandbox, labeledEvent({ number: 0 }));
  reject(sandbox, labeledEvent({ number: '7' }));
  reject(sandbox, { ...labeledEvent(), issue: undefined });
});

test('resolveTarget: repository names compare case-insensitively', () => {
  const target = resolveTarget({
    environment: environmentFor('MenashSoffer/Pipeline-Sandbox'),
    event: labeledEvent(),
    stage: 'plan',
  });
  assert.equal(target.repository, 'MenashSoffer/Pipeline-Sandbox');
});

test('same issue number in two repositories: distinct keys', () => {
  const sandbox = sandboxTarget('develop');
  const workspace = resolveTarget({
    environment: environmentFor('menashsoffer/nx-ai-agents-workspace', '202'),
    event: labeledEvent({
      repository: 'menashsoffer/nx-ai-agents-workspace',
      repositoryId: 202,
      label: 'stage:planned',
    }),
    stage: 'develop',
  });
  assert.equal(sandbox.issue, workspace.issue);
  assert.notEqual(sandbox.key, workspace.key);
  assert.notEqual(sandbox.repositoryId, workspace.repositoryId);
});

test('defaultBranchOf: from the event payload, safe as a ref name', () => {
  const withBranch = (name) => ({ repository: { default_branch: name } });
  assert.equal(defaultBranchOf(withBranch('main')), 'main');
  assert.equal(defaultBranchOf(withBranch('release/v1')), 'release/v1');
  for (const bad of ['', '../main', '/main', 'main/', 'a b', 'x;rm', undefined])
    assert.throws(
      () => defaultBranchOf(withBranch(bad)),
      /default branch/,
      String(bad),
    );
  assert.throws(() => defaultBranchOf(null), /default branch/);
});

test('baseFromReference: only a commit object from GitHub is a base', () => {
  assert.equal(
    baseFromReference({ object: { type: 'commit', sha: BASE_COMMIT } }),
    BASE_COMMIT,
  );
  for (const reference of [
    { object: { type: 'tag', sha: BASE_COMMIT } },
    { object: { type: 'commit', sha: 'main' } },
    { object: null },
    null,
  ])
    assert.throws(
      () => baseFromReference(reference),
      /does not point at a commit/,
    );
});
