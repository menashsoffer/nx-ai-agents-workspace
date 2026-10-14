// Run: pnpm test:pipeline
// The verify orchestrator's resolution, protection and decisions, with an
// injected file system (a protected toolchain needs root to build for real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  protectionProblems,
  resolveProgram,
  resolvePrograms,
} from './engine-programs.mjs';
import {
  planVerification,
  runVerification,
} from './engine-verify-commands.mjs';

/** A file system from `{ path: { uid, mode, kind, target } }`; folders default to root 0755. */
function fakeFileSystem(entries) {
  const entryOf = (path) =>
    entries[path] ?? { uid: 0, mode: 0o755, kind: 'folder' };
  return {
    realpath: (path) => entryOf(path).target ?? path,
    stat: (path) => {
      const entry = entryOf(path);
      return {
        uid: entry.uid,
        mode: entry.mode,
        isFile: () => entry.kind === 'file',
      };
    },
    isExecutable: (path) =>
      Boolean(entries[path]) &&
      entryOf(entryOf(path).target ?? path).kind === 'file',
  };
}

const protectedToolchain = {
  '/opt/tool/node/bin/node': { uid: 0, mode: 0o755, kind: 'file' },
  '/opt/tool/node/bin/pnpm': {
    uid: 0,
    mode: 0o777,
    kind: 'link',
    target: '/opt/tool/node/lib/pnpm.js',
  },
  '/opt/tool/node/lib/pnpm.js': { uid: 0, mode: 0o755, kind: 'file' },
};

test('resolveProgram: absolute PATH entries, in order, to the real file', () => {
  const fileSystem = fakeFileSystem(protectedToolchain);
  assert.equal(
    resolveProgram('node', 'relative:/opt/tool/node/bin', fileSystem),
    '/opt/tool/node/bin/node',
  );
  assert.equal(
    resolveProgram('pnpm', '/opt/tool/node/bin', fileSystem),
    '/opt/tool/node/lib/pnpm.js',
  );
  assert.equal(resolveProgram('git', '/opt/tool/node/bin', fileSystem), null);
  assert.equal(
    resolveProgram('../node', '/opt/tool/node/bin', fileSystem),
    null,
  );
  assert.equal(
    resolveProgram('/opt/tool/node/bin/node', '/', fileSystem),
    null,
  );
});

test('protectionProblems: the file and every folder above it', () => {
  const fileSystem = fakeFileSystem({
    ...protectedToolchain,
    '/home/runner/node': { uid: 1001, mode: 0o755, kind: 'file' },
    '/home/runner': { uid: 1001, mode: 0o755, kind: 'folder' },
    '/opt/open/node': { uid: 0, mode: 0o755, kind: 'file' },
    '/opt/open': { uid: 0, mode: 0o777, kind: 'folder' },
    '/opt/tool/node/bin/run': { uid: 0, mode: 0o775, kind: 'file' },
  });
  assert.deepEqual(
    protectionProblems('/opt/tool/node/bin/node', fileSystem),
    [],
  );
  assert.deepEqual(protectionProblems('/home/runner/node', fileSystem), [
    '/home/runner/node is not owned by root',
    '/home/runner is not owned by root',
  ]);
  assert.deepEqual(protectionProblems('/opt/open/node', fileSystem), [
    '/opt/open is writable by group or others',
  ]);
  assert.deepEqual(protectionProblems('/opt/tool/node/bin/run', fileSystem), [
    '/opt/tool/node/bin/run is writable by group or others',
  ]);
});

test('resolvePrograms: refuses root, missing and unprotected programs', () => {
  const fileSystem = fakeFileSystem(protectedToolchain);
  const ok = resolvePrograms(['node', 'pnpm', 'node'], {
    searchPath: '/opt/tool/node/bin',
    fileSystem,
    userId: 1001,
  });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.folders, ['/opt/tool/node/bin', '/opt/tool/node/lib']);
  const asRoot = resolvePrograms(['node'], {
    searchPath: '/opt/tool/node/bin',
    fileSystem,
    userId: 0,
  });
  assert.match(asRoot.problems.join(), /runs as root/);
  const missing = resolvePrograms(['git'], {
    searchPath: '/opt/tool/node/bin',
    fileSystem,
    userId: 1001,
  });
  assert.deepEqual(missing.problems, [
    'git is not on PATH as an executable file',
  ]);
});

const commands = {
  setup: [
    ['corepack', 'enable'],
    ['pnpm', 'install', '--frozen-lockfile'],
  ],
  verify: [['pnpm', 'verify']],
};
const resolveProtected = (names) =>
  resolvePrograms(names, {
    searchPath: '/opt/tool/node/bin',
    fileSystem: fakeFileSystem(protectedToolchain),
    userId: 1001,
  });

test('planVerification: absolute paths resolved once, a PATH of protected folders only', () => {
  let calls = 0;
  const plan = planVerification({
    commands,
    environment: { HOME: '/home/runner', CI: 'true' },
    resolve: (names) => {
      calls += 1;
      return resolveProtected(names);
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.path, step.args]),
    [
      ['setup', '/opt/tool/node/lib/pnpm.js', ['install', '--frozen-lockfile']],
      ['verify', '/opt/tool/node/lib/pnpm.js', ['verify']],
    ],
  );
  assert.deepEqual(plan.environment, {
    HOME: '/home/runner',
    CI: 'true',
    PATH: '/opt/tool/node/bin:/opt/tool/node/lib',
  });
  assert.ok(
    !Object.keys(plan.environment).some((name) =>
      /TOKEN|SECRET|KEY/.test(name),
    ),
  );
  assert.deepEqual(
    planVerification({
      commands: { setup: [], verify: [] },
      environment: {},
      resolve: resolveProtected,
    }).problems,
    ['the profile has no verify commands'],
  );
});

test('runVerification: the exit codes decide, by the planned paths only', () => {
  const plan = planVerification({
    commands,
    environment: {},
    resolve: resolveProtected,
  });
  const ran = [];
  const spawn = (exitCodes) => (path, args) => {
    ran.push([path, ...args].join(' '));
    return { status: exitCodes.shift() };
  };
  assert.deepEqual(runVerification({ ...plan, spawn: spawn([0, 0]) }), []);
  assert.deepEqual(ran, [
    '/opt/tool/node/lib/pnpm.js install --frozen-lockfile',
    '/opt/tool/node/lib/pnpm.js verify',
  ]);
  assert.deepEqual(runVerification({ ...plan, spawn: spawn([0, 1]) }), [
    'verify command failed (1): pnpm verify',
  ]);
  assert.deepEqual(runVerification({ ...plan, spawn: spawn([7]) }), [
    'setup command failed (7): pnpm install --frozen-lockfile',
  ]);
});
