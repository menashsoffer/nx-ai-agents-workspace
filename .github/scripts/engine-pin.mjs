// Engine pin check: a target may call the engine only by a full commit, and
// the engine code a job runs must be that same commit.
//
// The connector writes `uses: <engine>/.github/workflows/<file>@<commit>`
// and passes the same commit as the `engine-commit` input. Inside the
// called workflow, the GitHub OIDC token of the `pin` job says which
// workflow file and commit GitHub actually ran (`job_workflow_ref`,
// `job_workflow_sha`) and for which repository (`repository`, the caller).
// checkPin compares them; any mismatch fails the run before anything else.
//
// Pure: no I/O. engine.mjs fetches and decodes the token.

/** The repository that hosts the engine (its reusable workflows and scripts). */
export const ENGINE_REPOSITORY = 'menashsoffer/nx-ai-agents-workspace';

/** The engine's reusable workflows, the only ones a connector may call. */
export const ENGINE_WORKFLOWS = Object.freeze([
  'engine-plan.yml',
  'engine-develop.yml',
  'engine-publish.yml',
]);

const COMMIT_FORMAT = /^[0-9a-f]{40}$/;

export const isEngineCommit = (value) =>
  COMMIT_FORMAT.test(String(value ?? ''));

/** Decodes the claims of a JWT without checking its signature. */
export function decodeClaims(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new Error('The OIDC token is not a JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/**
 * Checks the OIDC claims of the pin job. Returns a list of problems (empty
 * when the pin holds):
 * - `engineCommit` is a full commit;
 * - GitHub ran `<ENGINE_REPOSITORY>/.github/workflows/<workflow>` at that
 *   commit, referenced by the commit itself (not a branch or tag);
 * - the caller is `repository` (the target from the workflow context);
 * - the checked-out engine is that commit (`checkedOut`).
 */
export function checkPin({
  claims,
  engineCommit,
  workflow,
  repository,
  checkedOut,
}) {
  const problems = [];
  if (!isEngineCommit(engineCommit))
    return ['engine-commit is not a full 40-character commit'];
  if (!ENGINE_WORKFLOWS.includes(workflow))
    return [`${workflow} is not an engine workflow`];
  const expectedReference = `${ENGINE_REPOSITORY}/.github/workflows/${workflow}@${engineCommit}`;
  if (claims?.job_workflow_sha !== engineCommit)
    problems.push('GitHub ran another engine commit than engine-commit');
  if (claims?.job_workflow_ref !== expectedReference)
    problems.push(
      'the engine workflow was not called by this exact commit (a branch, a tag or another file)',
    );
  if (
    String(claims?.repository ?? '').toLowerCase() !==
    String(repository ?? '').toLowerCase()
  )
    problems.push('the OIDC caller repository differs from GITHUB_REPOSITORY');
  if (checkedOut !== engineCommit)
    problems.push('the checked-out engine is not engine-commit');
  return problems;
}
