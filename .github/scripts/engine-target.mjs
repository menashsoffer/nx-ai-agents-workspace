// Target identity for the pipeline engine (engine-*.yml, called with
// workflow_call from a target repository's connector).
//
// The target is the repository and issue the run belongs to. It comes only
// from the workflow context: GITHUB_REPOSITORY, GITHUB_EVENT_NAME and the
// event payload GitHub wrote to GITHUB_EVENT_PATH (in a called workflow these
// are the caller's). Workflow inputs, the issue's title, body and comments
// never name the target, so a crafted issue cannot point a run elsewhere.
//
// Pure: no I/O. engine.mjs reads the environment and the event file.

/** Repository slug as GitHub allows it (`owner/name`). */
const REPOSITORY_FORMAT =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

const COMMIT_FORMAT = /^[0-9a-f]{40}$/;

/** The label that starts each engine stage (see docs/pipeline-engine.md). */
export const STAGE_LABELS = Object.freeze({
  plan: 'stage:qualified',
  develop: 'stage:planned',
  publish: 'stage:planned',
});

const MANIFEST_SCHEMA = 1;
const MANIFEST_FIELDS = [
  'schema',
  'repository',
  'repository_id',
  'issue',
  'base',
  'branch',
  'engine_commit',
];

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sameRepository = (left, right) =>
  String(left).toLowerCase() === String(right).toLowerCase();

/**
 * The target of this run, or an Error naming the first check that failed.
 * `environment` holds GITHUB_REPOSITORY, GITHUB_REPOSITORY_ID and
 * GITHUB_EVENT_NAME; `event` is the parsed payload; `stage` is plan,
 * develop or publish.
 * Returns `{ repository, repositoryId, issue, key }`; `key` is
 * `owner/name#issue`, unique across repositories (two repositories may
 * both have an issue 7).
 */
export function resolveTarget({ environment, event, stage }) {
  const fail = (reason) => {
    throw new Error(`Target identity rejected: ${reason}`);
  };
  if (!Object.hasOwn(STAGE_LABELS, stage)) fail(`unknown stage ${stage}`);
  const repository = environment.GITHUB_REPOSITORY ?? '';
  if (!REPOSITORY_FORMAT.test(repository))
    fail('GITHUB_REPOSITORY is not an owner/name slug');
  if (environment.GITHUB_EVENT_NAME !== 'issues')
    fail(
      `the event is ${environment.GITHUB_EVENT_NAME || 'missing'}, not issues`,
    );
  if (!isPlainObject(event)) fail('the event payload is missing');
  if (event.action !== 'labeled') fail('the issues event is not `labeled`');
  if (event.label?.name !== STAGE_LABELS[stage])
    fail(`the label is not ${STAGE_LABELS[stage]}`);
  const eventRepository = event.repository?.full_name;
  if (
    typeof eventRepository !== 'string' ||
    !sameRepository(eventRepository, repository)
  )
    fail('the event repository differs from GITHUB_REPOSITORY');
  const repositoryId = String(event.repository?.id ?? '');
  if (!/^[1-9]\d*$/.test(repositoryId)) fail('the event has no repository id');
  if (
    environment.GITHUB_REPOSITORY_ID &&
    environment.GITHUB_REPOSITORY_ID !== repositoryId
  )
    fail('the event repository id differs from GITHUB_REPOSITORY_ID');
  const issue = event.issue;
  if (!isPlainObject(issue)) fail('the event has no issue');
  if (issue.pull_request) fail('the item is a pull request');
  if (issue.state !== 'open') fail('the issue is not open');
  if (!Number.isInteger(issue.number) || issue.number <= 0)
    fail('the issue number is not a positive integer');
  return {
    repository,
    repositoryId,
    issue: issue.number,
    key: `${repository}#${issue.number}`,
  };
}

/**
 * The manifest that travels with the develop patch (an artifact of the same
 * run). It binds the patch to one target, one base commit of that target and
 * one engine commit.
 */
export function buildManifest({ target, base, branch, engineCommit }) {
  if (!COMMIT_FORMAT.test(base)) throw new Error('Bad base commit');
  if (!COMMIT_FORMAT.test(engineCommit)) throw new Error('Bad engine commit');
  return {
    schema: MANIFEST_SCHEMA,
    repository: target.repository,
    repository_id: target.repositoryId,
    issue: target.issue,
    base,
    branch,
    engine_commit: engineCommit,
  };
}

/**
 * Checks that `manifest` belongs to `target` and `engineCommit`. Returns a
 * list of problems (empty when it matches). The publish job refuses a patch
 * whose manifest names another repository, even with the same issue number.
 */
export function checkManifest(manifest, { target, engineCommit }) {
  if (!isPlainObject(manifest)) return ['the manifest is missing'];
  const problems = [];
  const extra = Object.keys(manifest).filter(
    (key) => !MANIFEST_FIELDS.includes(key),
  );
  if (extra.length)
    problems.push(`unknown manifest fields: ${extra.sort().join(', ')}`);
  if (manifest.schema !== MANIFEST_SCHEMA)
    problems.push('unknown manifest schema');
  if (!sameRepository(manifest.repository, target.repository))
    problems.push('the manifest names another repository');
  if (manifest.repository_id !== target.repositoryId)
    problems.push('the manifest names another repository id');
  if (manifest.issue !== target.issue)
    problems.push('the manifest names another issue');
  if (!COMMIT_FORMAT.test(String(manifest.base)))
    problems.push('the manifest base is not a commit');
  if (manifest.engine_commit !== engineCommit)
    problems.push('the manifest was built by another engine commit');
  const branchPrefix = `issue-${target.issue}-`;
  if (
    typeof manifest.branch !== 'string' ||
    !manifest.branch.startsWith(branchPrefix)
  )
    problems.push('the manifest branch is not the branch of this issue');
  return problems;
}
