// engine.mjs commands that build and check the develop attestation
// (engine-attestation.mjs). `attest` runs in the check job, `check-attestation`
// and `check-tree` in the publish job; none of them runs on the agent's runner.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setOutput } from './github.mjs';
import { parseFlags } from './pipeline-lib.mjs';
import {
  buildAttestation,
  checkAttestation,
  sha256Of,
  treeProblems,
} from './engine-attestation.mjs';
import { currentTarget, failOn } from './engine-cli-support.mjs';

/** The tree of HEAD in the current directory (the target after `git am`). */
const headTree = () =>
  execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    encoding: 'utf8',
  }).trim();

/** The attestation JSON handed over in the ATTESTATION environment variable. */
function attestationFromEnvironment() {
  try {
    return JSON.parse(process.env.ATTESTATION ?? '');
  } catch {
    return null;
  }
}

export const attestationCommands = {
  // Check job, after it applied the patch to --base itself: outputs the
  // attestation (target, base, branch, engine commit, patch hash, tree).
  attest(args) {
    const flags = parseFlags(args);
    const attestation = buildAttestation({
      target: currentTarget(flags.stage),
      base: flags.base,
      branch: flags.branch,
      engineCommit: flags['engine-commit'],
      patchSha256: sha256Of(readFileSync(flags.patch)),
      tree: headTree(),
    });
    setOutput('attestation', JSON.stringify(attestation));
  },

  // Publish job, before it applies anything: exit 1 unless the attestation
  // matches this target, engine commit, pinned --base and the patch file.
  // Outputs the base and branch to use.
  'check-attestation'(args) {
    const flags = parseFlags(args);
    const attestation = attestationFromEnvironment();
    failOn(
      checkAttestation(attestation, {
        target: currentTarget(flags.stage),
        engineCommit: flags['engine-commit'],
        base: flags.base,
        patchSha256: sha256Of(readFileSync(flags.patch)),
      }),
      'Attestation',
    );
    setOutput('base', attestation.base);
    setOutput('branch', attestation.branch);
  },

  // Publish job, after `git am`: exit 1 unless HEAD has the attested tree.
  'check-tree'() {
    failOn(
      treeProblems(attestationFromEnvironment(), headTree()),
      'Attestation',
    );
  },
};
