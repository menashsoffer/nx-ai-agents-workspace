#!/usr/bin/env node
// Deterministic steps of the pipeline engine, called from the engine's
// reusable workflows (.github/workflows/engine-*.yml) with the engine
// checked out at its pinned commit. See docs/pipeline-engine.md.
// Usage: node engine.mjs <command> [args...]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { api, setOutput } from './github.mjs';
import { branchName, classifyPatch, parseFlags } from './pipeline-lib.mjs';
import { checkPin, decodeClaims } from './engine-pin.mjs';
import { scanRequest } from './engine-request.mjs';
import {
  COMMIT_LOG_FORMAT,
  scanCommits,
  scanOutput,
} from './engine-output-scan.mjs';
import { encodeFindings } from './engine-notes.mjs';
import { noteCommands } from './engine-note-commands.mjs';
import { baseFromReference, defaultBranchOf } from './engine-target.mjs';
import { attestationCommands } from './engine-attestation-commands.mjs';
import {
  currentEvent,
  currentTarget,
  failOn,
  readJson,
} from './engine-cli-support.mjs';

/** The pin job's OIDC token, requested from the runner (needs id-token: write). */
async function requestOidcToken() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN } =
    process.env;
  if (!ACTIONS_ID_TOKEN_REQUEST_URL || !ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    throw new Error('No OIDC token: the pin job needs id-token: write');
  const url = new URL(ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', 'pipeline-engine');
  const response = await fetch(url, {
    headers: { Authorization: `bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (!response.ok)
    throw new Error(`OIDC token request failed: HTTP ${response.status}`);
  return (await response.json()).value;
}

const readIfGiven = (path) => (path ? readFileSync(path, 'utf8') : '');

const commands = {
  ...attestationCommands,
  ...noteCommands,

  // Fails unless the target resolves from the workflow context, GitHub ran
  // this engine workflow at --engine-commit for that target, and
  // --engine-dir holds that commit. Outputs the commit and the target. With
  // --resolve-base it also reads the target's default-branch head from the
  // GitHub API (GH_TOKEN) and outputs it as `base`, with the branch name:
  // the only base later jobs use, recorded before the agent job starts.
  async pin(args) {
    const flags = parseFlags(args);
    const target = currentTarget(flags.stage);
    const checkedOut = execFileSync(
      'git',
      ['-C', flags['engine-dir'], 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();
    const claims = decodeClaims(await requestOidcToken());
    failOn(
      checkPin({
        claims,
        engineCommit: flags['engine-commit'],
        workflow: flags.workflow,
        repository: target.repository,
        checkedOut,
      }),
      'Engine pin',
    );
    setOutput('commit', checkedOut);
    setOutput('repository', target.repository);
    setOutput('issue', target.issue);
    setOutput('key', target.key);
    if (!Object.hasOwn(flags, 'resolve-base')) return;
    const defaultBranch = defaultBranchOf(currentEvent());
    const reference = api(`git/ref/heads/${defaultBranch}`);
    setOutput('base', baseFromReference(reference));
    setOutput('branch', branchName(target.issue, currentEvent().issue.title));
  },

  // Scans the agent's output before anything from it is published or
  // posted: --result (its JSON), --patch, and each --text <file> (for
  // example the PR body). Outputs is_clean and, when false, `findings` as
  // `field:kind,...` (safe-note --kind output validates them).
  // With --fail it also exits 1 when it finds something.
  'check-output'(args) {
    const flags = parseFlags(args);
    const texts = Object.fromEntries(
      []
        .concat(flags.text ?? [])
        .map((path) => [path.split('/').pop(), readFileSync(path, 'utf8')]),
    );
    const { isClean, findings } = scanOutput({
      result: readIfGiven(flags.result),
      patch: readIfGiven(flags.patch),
      texts,
    });
    if (!isClean) setOutput('findings', encodeFindings(findings));
    setOutput('is_clean', String(isClean));
    if (Object.hasOwn(flags, 'fail'))
      failOn(
        findings.map(
          (finding) =>
            `secret-shaped value in ${finding.field} (${finding.kinds.join(', ')})`,
        ),
        'Output',
      );
  },

  // Scans the commits that would be pushed (base..HEAD in cwd): author,
  // committer, subject and body. Outputs is_clean and `findings`; exit 1
  // with --fail.
  'check-commits'(args) {
    const flags = parseFlags(args);
    const log = execFileSync(
      'git',
      ['log', `--format=${COMMIT_LOG_FORMAT}`, `${flags.base}..HEAD`],
      { encoding: 'utf8' },
    );
    const { isClean, findings } = scanCommits(log);
    if (!isClean) setOutput('findings', encodeFindings(findings));
    setOutput('is_clean', String(isClean));
    if (Object.hasOwn(flags, 'fail'))
      failOn(
        findings.map(
          (finding) =>
            `secret-shaped value in ${finding.field} (${finding.kinds.join(', ')})`,
        ),
        'Commits',
      );
  },

  // Scans the collected issue for secrets. Outputs is_clean (true | false)
  // and, when false, `findings` as `field:kind,...` (engine-notes.mjs); the
  // publish job builds the note from them after validating each one.
  'check-request'(args) {
    const flags = parseFlags(args);
    const { isClean, findings } = scanRequest(readJson(flags._[0]));
    if (!isClean) {
      setOutput('findings', encodeFindings(findings));
      for (const finding of findings)
        console.log(
          `::warning::Secret-shaped value in ${finding.field} (${finding.kinds.join(', ')}); the agent will not run.`,
        );
    }
    setOutput('is_clean', String(isClean));
  },

  // Exit 1 unless the patch touches no protected path at all: the engine
  // has no owner-approval flow, so approvable paths are rejected too.
  'check-patch'(args) {
    const flags = parseFlags(args);
    const result = classifyPatch(readFileSync(flags._[0], 'utf8'));
    setOutput('protected_paths', result.protected.join(','));
    if (result.kind === 'none') return;
    setOutput('rejected', 'true');
    failOn(
      [
        ...result.errors,
        ...result.protected.map((path) => `protected: ${path}`),
      ],
      'Patch rejected',
    );
  },
};

const [, , command, ...commandArguments] = process.argv;
if (!Object.hasOwn(commands, command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(2);
}
try {
  await commands[command](commandArguments);
} catch (error) {
  console.log(`::error::${error.message}`);
  process.exit(1);
}
