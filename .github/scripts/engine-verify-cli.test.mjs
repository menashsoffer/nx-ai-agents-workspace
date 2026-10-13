// Run: pnpm test:pipeline
// Regression: a setup command that overwrites the engine with
// `process.exit(0)` must not turn a failing verify command into a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
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

/**
 * A copy of the engine scripts (so the test can let setup destroy them), a
 * target whose setup overwrites every engine file with `process.exit(0)`,
 * and a verify command that exits with `verifyExit`.
 */
function sabotagedRun({ verifyExit, setupOverwrites = true }) {
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
    setupOverwrites
      ? `import { readdirSync, writeFileSync } from 'node:fs';\nfor (const file of readdirSync(${JSON.stringify(engine)}))\n  writeFileSync(${JSON.stringify(engine)} + '/' + file, 'process.exit(0);\\n');\nwriteFileSync(${JSON.stringify(join(directory, 'profile.json'))}, '{"commands":{"setup":[],"verify":[]}}');\n`
      : 'process.exit(0);\n',
  );
  writeFileSync(
    join(target, 'scripts/verify.mjs'),
    `process.exit(${verifyExit});\n`,
  );
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
  const run = (...args) =>
    spawnSync(process.execPath, [join(engine, 'engine.mjs'), ...args], {
      cwd: target,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
  return { engine, profile, run };
}

test('verify-target: a sabotaging setup cannot hide a failing verify', () => {
  const { engine, profile, run } = sabotagedRun({ verifyExit: 1 });
  const result = run('verify-target', '--profile', profile);
  assert.equal(result.status, 1, result.stdout);
  assert.match(
    result.stdout,
    /verify command failed \(1\): node scripts\/verify\.mjs/,
  );
  // setup really did overwrite the engine on disk
  assert.equal(
    readFileSync(join(engine, 'engine.mjs'), 'utf8'),
    'process.exit(0);\n',
  );
});

test('the old two-process way is what this prevents', () => {
  const { profile, run } = sabotagedRun({ verifyExit: 1 });
  assert.equal(
    run('run-commands', '--kind', 'setup', '--profile', profile).status,
    0,
  );
  // the second process loads the overwritten engine and "passes"
  assert.equal(
    run('run-commands', '--kind', 'verify', '--profile', profile).status,
    0,
  );
});

test('verify-target: passes only when every command passes', () => {
  const honest = sabotagedRun({ verifyExit: 0, setupOverwrites: false });
  const passed = honest.run('verify-target', '--profile', honest.profile);
  assert.equal(passed.status, 0, passed.stdout);
  assert.match(passed.stdout, /verify: 2 command\(s\) passed/);
  const failingSetup = sabotagedRun({ verifyExit: 0, setupOverwrites: false });
  writeFileSync(
    join(failingSetup.profile),
    JSON.stringify({
      commands: {
        setup: [['node', '-e', 'process.exit(4)']],
        verify: [['node', 'scripts/verify.mjs']],
      },
    }),
  );
  const stopped = failingSetup.run(
    'verify-target',
    '--profile',
    failingSetup.profile,
  );
  assert.equal(stopped.status, 1);
  assert.match(stopped.stdout, /setup command failed \(4\)/);
  const empty = sabotagedRun({ verifyExit: 0, setupOverwrites: false });
  writeFileSync(
    empty.profile,
    JSON.stringify({ commands: { setup: [], verify: [] } }),
  );
  assert.equal(
    empty.run('verify-target', '--profile', empty.profile).status,
    1,
  );
});
