// Develop attestation: what the engine vouches for before publish may push.
//
// Nothing produced on the agent's runner is trusted: the agent can read and
// write that whole machine, so a patch, a claimed base or a claimed result
// from there is data to check, never a fact. The attestation is built
// instead from values GitHub carries between jobs (job outputs), on runners
// that never ran agent code:
// - base and branch: the `pin` job reads the target's default-branch head
//   from the GitHub API before the agent job starts;
// - patch_sha256 and tree: the `check` job hashes the patch artifact and
//   applies it to that base itself (`git am`), then records the tree;
// - verification: `passed` only when every check of that job passed.
// Publish compares the attestation with the base from the pin job, the
// patch it downloads and the tree it gets from applying that patch again.
//
// Pure: no I/O.
import { createHash } from 'node:crypto';

const ATTESTATION_SCHEMA = 1;
const ATTESTATION_FIELDS = [
  'schema',
  'repository',
  'repository_id',
  'issue',
  'base',
  'branch',
  'engine_commit',
  'patch_sha256',
  'tree',
  'verification',
];
const OBJECT_FORMAT = /^[0-9a-f]{40}$/;
const SHA256_FORMAT = /^[0-9a-f]{64}$/;

export const sha256Of = (content) =>
  createHash('sha256').update(content).digest('hex');

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The attestation the check job outputs (all inputs from trusted jobs). */
export function buildAttestation({
  target,
  base,
  branch,
  engineCommit,
  patchSha256,
  tree,
}) {
  for (const [name, value] of [
    ['base', base],
    ['engine commit', engineCommit],
    ['tree', tree],
  ])
    if (!OBJECT_FORMAT.test(String(value))) throw new Error(`Bad ${name}`);
  if (!SHA256_FORMAT.test(String(patchSha256)))
    throw new Error('Bad patch hash');
  if (!String(branch).startsWith(`issue-${target.issue}-`))
    throw new Error('Bad branch');
  return {
    schema: ATTESTATION_SCHEMA,
    repository: target.repository,
    repository_id: target.repositoryId,
    issue: target.issue,
    base,
    branch,
    engine_commit: engineCommit,
    patch_sha256: patchSha256,
    tree,
    verification: 'passed',
  };
}

/**
 * Problems with an attestation before publish applies the patch (empty when
 * it holds): same shape, same target (repository, id and issue: issue 7 of
 * another repository never matches), same engine commit, the base the pin
 * job recorded (not an older one), a passed verification, and the hash of
 * the patch publish actually downloaded.
 */
export function checkAttestation(
  attestation,
  { target, engineCommit, base, patchSha256 },
) {
  if (!isPlainObject(attestation)) return ['the attestation is missing'];
  const problems = [];
  const extra = Object.keys(attestation).filter(
    (key) => !ATTESTATION_FIELDS.includes(key),
  );
  const missing = ATTESTATION_FIELDS.filter((key) => !(key in attestation));
  if (extra.length) problems.push(`unknown fields: ${extra.sort().join(', ')}`);
  if (missing.length) problems.push(`missing fields: ${missing.join(', ')}`);
  if (attestation.schema !== ATTESTATION_SCHEMA)
    problems.push('unknown schema');
  if (
    String(attestation.repository).toLowerCase() !==
    target.repository.toLowerCase()
  )
    problems.push('it names another repository');
  if (attestation.repository_id !== target.repositoryId)
    problems.push('it names another repository id');
  if (attestation.issue !== target.issue)
    problems.push('it names another issue');
  if (attestation.engine_commit !== engineCommit)
    problems.push('it was built by another engine commit');
  if (!OBJECT_FORMAT.test(String(base)))
    problems.push('the pinned base is not a commit');
  else if (attestation.base !== base)
    problems.push('its base is not the base the pin job recorded');
  if (!String(attestation.branch).startsWith(`issue-${target.issue}-`))
    problems.push('its branch is not the branch of this issue');
  if (attestation.verification !== 'passed')
    problems.push('its verification did not pass');
  if (!OBJECT_FORMAT.test(String(attestation.tree)))
    problems.push('its tree is not a git object id');
  if (attestation.patch_sha256 !== patchSha256)
    problems.push('the patch is not the one that was checked');
  return problems;
}

/** After publish re-applies the patch: the tree must be the attested one. */
export const treeProblems = (attestation, tree) =>
  attestation?.tree === tree
    ? []
    : ['applying the patch gave another tree than the attested one'];
