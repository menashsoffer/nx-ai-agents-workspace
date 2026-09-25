// Run with: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs `body` (module code using github.mjs) with a fake `gh` first on PATH
// that records its arguments and prints `{}`.
function withFakeGh(body) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const log = join(dir, 'calls.json');
  const gh = join(dir, 'gh');
  writeFileSync(
    gh,
    `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.stdout.write('{"default_branch":"main"}');\n`,
  );
  chmodSync(gh, 0o755);
  const url = new URL('./github.mjs', import.meta.url).href;
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import * as g from ${JSON.stringify(url)};\n${body}`,
    ],
    {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'o/r',
      },
      stdio: 'pipe',
    },
  );
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
}

test('api(): the repository itself is repos/<owner>/<repo>, never with a trailing slash', () => {
  const [call] = withFakeGh(`g.api('');`);
  assert.ok(call.includes('repos/o/r'), call.join(' '));
  assert.ok(!call.some((a) => a.endsWith('/')), call.join(' '));
});

test('api(): relative paths hang off the repository, a leading slash is absolute', () => {
  const calls = withFakeGh(`g.api('pulls/7'); g.api('/orgs/x');`);
  assert.ok(calls[0].includes('repos/o/r/pulls/7'));
  assert.ok(calls[1].includes('orgs/x'));
  assert.ok(!calls[1].some((a) => a.includes('repos/o/r')));
});
