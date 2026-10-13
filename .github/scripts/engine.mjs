#!/usr/bin/env node
// Deterministic steps of the pipeline engine, called from the engine's
// reusable workflows (.github/workflows/engine-*.yml) with the engine
// checked out at its pinned commit. See docs/pipeline-engine.md.
// Usage: node engine.mjs <command> [args...]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setOutput } from './github.mjs';
import { parseFlags } from './pipeline-lib.mjs';
import { checkPin, decodeClaims } from './engine-pin.mjs';
import { failOn, profileCommands } from './engine-profile-commands.mjs';
import { requestOutcome, scanRequest } from './engine-request.mjs';
import {
  buildManifest,
  checkManifest,
  resolveTarget,
} from './engine-target.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The target of this run, from the workflow context only (engine-target.mjs). */
function currentTarget(stage) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  return resolveTarget({
    environment: process.env,
    event: eventPath ? readJson(eventPath) : null,
    stage,
  });
}

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

const commands = {
  ...profileCommands,

  // Fails unless the target resolves from the workflow context, GitHub ran
  // this engine workflow at --engine-commit for that target, and
  // --engine-dir holds that commit. Outputs the commit and the target.
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
  },

  // Scans the collected issue for secrets. Outputs is_clean (true | false)
  // and, when false, `outcome`: the outcome note JSON to post.
  'check-request'(args) {
    const flags = parseFlags(args);
    const { isClean, findings } = scanRequest(readJson(flags._[0]));
    if (!isClean) {
      setOutput(
        'outcome',
        JSON.stringify(requestOutcome(flags.stage, findings)),
      );
      for (const finding of findings)
        console.log(
          `::warning::Secret-shaped value in ${finding.field} (${finding.kinds.join(', ')}); the agent will not run.`,
        );
    }
    setOutput('is_clean', String(isClean));
  },

  // Writes the patch manifest that binds a develop patch to its target.
  manifest(args) {
    const flags = parseFlags(args);
    const manifest = buildManifest({
      target: currentTarget(flags.stage),
      base: flags.base,
      branch: flags.branch,
      engineCommit: flags['engine-commit'],
    });
    writeFileSync(flags.out, JSON.stringify(manifest, null, 2));
  },

  // Exit 1 unless the manifest belongs to this run's target and engine.
  // Outputs the base commit and branch it names.
  'check-manifest'(args) {
    const flags = parseFlags(args);
    const manifest = readJson(flags._[0]);
    failOn(
      checkManifest(manifest, {
        target: currentTarget(flags.stage),
        engineCommit: flags['engine-commit'],
      }),
      'Patch manifest',
    );
    setOutput('base', manifest.base);
    setOutput('branch', manifest.branch);
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
