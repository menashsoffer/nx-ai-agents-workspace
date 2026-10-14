// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchMetadataProblems } from './engine-patch-metadata.mjs';
import { buildPolicy, checkPatchPolicy } from './engine-policy.mjs';
import { validateProfile } from './engine-profile.mjs';

/** A git patch that creates `path` with `mode` (as git format-patch writes it). */
const newFile = (
  path,
  mode,
  body = '+/etc/hostname\n\\ No newline at end of file\n',
) =>
  `diff --git a/${path} b/${path}\nnew file mode ${mode}\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n${body}`;

test('a regular new file or edit passes', () => {
  assert.deepEqual(
    patchMetadataProblems(newFile('SANDBOX_PROBE.md', '100644', '+# Probe\n')),
    [],
  );
  const edit =
    'diff --git a/a.md b/a.md\nindex 1111111..2222222 100644\n--- a/a.md\n+++ b/a.md\n@@ -1 +1 @@\n-a\n+b\n';
  assert.deepEqual(patchMetadataProblems(edit), []);
});

test('SANDBOX_PROBE.md as a symbolic link to /etc/hostname is rejected', () => {
  const link = newFile('SANDBOX_PROBE.md', '120000');
  assert.deepEqual(patchMetadataProblems(link), [
    'SANDBOX_PROBE.md: new file with mode 120000 (only 100644)',
  ]);
  const policy = buildPolicy(
    validateProfile({
      schema: 1,
      name: 'sandbox',
      summary: 'Docs.',
      commands: { verify: [] },
      checks: ['writable-paths'],
      paths: { writable: ['SANDBOX_PROBE.md'] },
    }).profile,
  );
  assert.equal(checkPatchPolicy(link, policy).ok, false);
  // an existing file turned into a link: the index line carries the mode
  const turned =
    'diff --git a/SANDBOX_PROBE.md b/SANDBOX_PROBE.md\nindex 1111111..2222222 120000\n--- a/SANDBOX_PROBE.md\n+++ b/SANDBOX_PROBE.md\n@@ -1 +1 @@\n-a\n+/etc/hostname\n';
  assert.equal(patchMetadataProblems(turned).length, 1);
});

test('mode changes, executables, submodules and binaries are rejected', () => {
  const modeChange =
    'diff --git a/a.sh b/a.sh\nold mode 100644\nnew mode 100755\n';
  assert.deepEqual(patchMetadataProblems(modeChange), [
    'a.sh: changes the file mode',
  ]);
  assert.equal(
    patchMetadataProblems(newFile('run.sh', '100755', '+echo\n')).length,
    1,
  );
  assert.equal(
    patchMetadataProblems(
      newFile('vendor/lib', '160000', '+Subproject commit abc\n'),
    ).length,
    1,
  );
  const binary =
    'diff --git a/x.png b/x.png\nnew file mode 100644\nindex 0000000..1111111\nGIT binary patch\nliteral 3\n';
  assert.deepEqual(patchMetadataProblems(binary), ['x.png: binary content']);
  const deletedLink = 'diff --git a/l b/l\ndeleted file mode 120000\n';
  assert.equal(patchMetadataProblems(deletedLink).length, 1);
});
