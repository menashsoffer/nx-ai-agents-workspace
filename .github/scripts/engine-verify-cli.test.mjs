// Run: pnpm test:pipeline
// Regressions for the verify orchestrator, end to end: neither a setup that
// replaces a program shim with `exit 0` nor one that overwrites the engine
// may turn a failing verify command into a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = fileURLToPath(new URL('.', import.meta.url));

/** A copy of the engine, a target and a profile; `setupScript` is the setup's code. */
function prepared(setupScript) {
  const directory = mkdtempSync(join(tmpdir(), 'engine-verify-'));
  const engine = join(directory, 'engine');
  mkdirSync(engine);
  for (const file of readdirSync(SCRIPTS).filter(
    (name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'),
  ))
    copyFileSync(join(SCRIPTS, file), join(engine, file));
  const target = join(directory, 'target');
  mkdirSync(join(target, 'scripts'), { recursive: true });
  writeFileSync(
    join(target, 'scripts/setup.mjs'),
    setupScript({ directory, engine }),
  );
  writeFileSync(join(target, 'scripts/verify.mjs'), 'process.exit(1);\n');
  const profile = join(directory, 'profile.json');
  writeFileSync(
    profile,
    JSON.stringify({
      commands: {
        setup: [['node', 'scripts/setup.mjs']],
        verify: [['node', 'scripts/verify.mjs']],
      },
    }),
  );
  return { directory, engine, target, profile };
}

test('regression: setup replaces the node shim with exit 0, a failing verify still fails', () => {
  const run = prepared(
    ({ directory }) =>
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(directory, 'shims/node'))}, '#!/bin/sh\\nexit 0\\n');\n`,
  );
  // a node shim in a folder anyone may write, first on PATH, like a toolcache
  const shims = join(run.directory, 'shims');
  mkdirSync(shims);
  const shim = join(shims, 'node');
  writeFileSync(
    shim,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
  );
  chmodSync(shim, 0o777);
  chmodSync(shims, 0o777);
  const result = spawnSync(
    process.execPath,
    [join(run.engine, 'engine.mjs'), 'verify-target', '--profile', run.profile],
    {
      cwd: run.target,
      encoding: 'utf8',
      env: { PATH: `${shims}:${process.env.PATH}`, HOME: process.env.HOME },
    },
  );
  assert.equal(result.status, 1, result.stdout);
  assert.match(
    result.stdout,
    new RegExp(`node: ${shims}/node is writable by group or others`),
  );
  // it refused before running anything: the shim was never replaced
  assert.match(readFileSync(shim, 'utf8'), /^#!\/bin\/sh\nexec /);
});

test('regression: a setup that overwrites the engine does not get to run', () => {
  const run = prepared(
    ({ engine }) =>
      `import { readdirSync, writeFileSync } from 'node:fs';\nfor (const file of readdirSync(${JSON.stringify(engine)}))\n  writeFileSync(${JSON.stringify(engine)} + '/' + file, 'process.exit(0);\\n');\n`,
  );
  const result = spawnSync(
    process.execPath,
    [join(run.engine, 'engine.mjs'), 'verify-target', '--profile', run.profile],
    {
      cwd: run.target,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
  assert.equal(result.status, 1, result.stdout);
  assert.notEqual(
    readFileSync(join(run.engine, 'engine.mjs'), 'utf8'),
    'process.exit(0);\n',
  );
});

test('run-commands refuses verify commands; only verify-target runs them', () => {
  const run = prepared(() => 'process.exit(0);\n');
  const refused = spawnSync(
    process.execPath,
    [
      join(run.engine, 'engine.mjs'),
      'run-commands',
      '--kind',
      'verify',
      '--profile',
      run.profile,
    ],
    {
      cwd: run.target,
      encoding: 'utf8',
    },
  );
  assert.equal(refused.status, 1);
  assert.match(
    refused.stdout,
    /run-commands only runs setup; use verify-target/,
  );
});
