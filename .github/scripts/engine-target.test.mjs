// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_LABELS,
  buildManifest,
  checkManifest,
  resolveTarget,
} from './engine-target.mjs';

const ENGINE_COMMIT = 'a'.repeat(40);
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

test('same issue number in two repositories: distinct keys, manifests do not cross', () => {
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
  const manifest = buildManifest({
    target: sandbox,
    base: BASE_COMMIT,
    branch: 'issue-7-probe',
    engineCommit: ENGINE_COMMIT,
  });
  assert.deepEqual(
    checkManifest(manifest, { target: sandbox, engineCommit: ENGINE_COMMIT }),
    [],
  );
  assert.deepEqual(
    checkManifest(manifest, { target: workspace, engineCommit: ENGINE_COMMIT }),
    [
      'the manifest names another repository',
      'the manifest names another repository id',
    ],
  );
});

test('checkManifest: rejects another issue, engine, branch or shape', () => {
  const target = sandboxTarget('publish');
  const good = buildManifest({
    target,
    base: BASE_COMMIT,
    branch: 'issue-7-probe',
    engineCommit: ENGINE_COMMIT,
  });
  const check = (manifest, engineCommit = ENGINE_COMMIT) =>
    checkManifest(manifest, { target, engineCommit });
  assert.deepEqual(check({ ...good, issue: 8 }), [
    'the manifest names another issue',
  ]);
  assert.deepEqual(check(good, 'c'.repeat(40)), [
    'the manifest was built by another engine commit',
  ]);
  assert.deepEqual(check({ ...good, branch: 'issue-70-probe' }), [
    'the manifest branch is not the branch of this issue',
  ]);
  assert.deepEqual(check({ ...good, base: 'main' }), [
    'the manifest base is not a commit',
  ]);
  assert.deepEqual(check({ ...good, extra: 1 }), [
    'unknown manifest fields: extra',
  ]);
  assert.deepEqual(check({ ...good, schema: 2 }), ['unknown manifest schema']);
  assert.deepEqual(check(null), ['the manifest is missing']);
});

test('buildManifest: requires full commits', () => {
  const target = sandboxTarget('develop');
  const build = (base, engineCommit) =>
    buildManifest({ target, base, branch: 'issue-7-x', engineCommit });
  assert.throws(() => build('main', ENGINE_COMMIT), /base commit/);
  assert.throws(() => build(BASE_COMMIT, 'v1.0.0'), /engine commit/);
});
