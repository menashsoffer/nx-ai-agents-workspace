// Run with: node --test .claude/hooks/verify-stamp.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const scriptPath = resolve(import.meta.dirname, 'verify-stamp.sh');

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'verify-stamp-'));
  execFileSync('git', ['init', '-q'], { cwd: directory });
  writeFileSync(join(directory, 'a.txt'), 'one');
  return directory;
}

function run(directory, action, command, mode) {
  const input = JSON.stringify({ tool_input: { command } });
  return spawnSync('bash', [scriptPath, action], {
    cwd: directory,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: directory,
      CLAUDE_VERIFY_STAMP: mode,
    },
  });
}

test('observe warns but does not block an unstamped commit', () => {
  const directory = createRepository();
  const result = run(directory, 'check', 'git commit -m x', 'observe');
  assert.equal(result.status, 0);
  assert.match(result.stderr, /observe/);
});

test('enforce blocks an unstamped commit and a push', () => {
  const directory = createRepository();
  assert.equal(run(directory, 'check', 'git commit -m x', 'enforce').status, 2);
  assert.equal(
    run(directory, 'check', 'pnpm i && git push origin x', 'enforce').status,
    2,
  );
});

test('a stamp for the exact tree lets enforce through, a later edit invalidates it', () => {
  const directory = createRepository();
  assert.equal(run(directory, 'write', '', 'enforce').status, 0);
  assert.equal(run(directory, 'check', 'git commit -m x', 'enforce').status, 0);
  writeFileSync(join(directory, 'a.txt'), 'two');
  assert.equal(run(directory, 'check', 'git commit -m x', 'enforce').status, 2);
});

test('other commands and mode off are ignored', () => {
  const directory = createRepository();
  assert.equal(run(directory, 'check', 'git status', 'enforce').status, 0);
  assert.equal(run(directory, 'check', 'git commit -m x', 'off').status, 0);
});
