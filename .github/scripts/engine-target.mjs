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
  check: 'stage:planned',
  publish: 'stage:planned',
});

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

/** Branch names GitHub accepts that are also safe in a git ref path. */
const BRANCH_FORMAT = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]{1,200}$/;

/** The default branch named by the event payload (workflow context). */
export function defaultBranchOf(event) {
  const branch = event?.repository?.default_branch;
  if (typeof branch !== 'string' || !BRANCH_FORMAT.test(branch))
    throw new Error('Target identity rejected: no valid default branch');
  return branch;
}

/**
 * The base commit from GitHub's answer to `GET git/ref/heads/<default>`:
 * read by the pin job, before and outside the agent's job.
 */
export function baseFromReference(reference) {
  const object = reference?.object;
  if (object?.type !== 'commit' || !COMMIT_FORMAT.test(String(object.sha)))
    throw new Error('The default branch does not point at a commit');
  return object.sha;
}
