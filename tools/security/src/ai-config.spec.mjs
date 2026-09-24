import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkClaudePermissions,
  checkClaudePlugins,
  checkClaudeSafetySwitches,
  checkCodexSafetySwitches,
  checkGeminiSafetySwitches,
  checkMcpServers,
  checkRepoAiConfig,
  parseCodexMcpServers,
} from './ai-config.mjs';

describe('A1: Claude permission allow-list', () => {
  it.each([
    'Bash(pnpm nx:*)',
    'Bash(pnpm nx run:*)',
    'Bash(pnpm exec:*)',
    'Bash(npx:*)',
    'Bash(*)',
    'Bash',
    'Bash(pnpm:*)',
  ])('rejects %s', (rule) => {
    expect(
      checkClaudePermissions({ permissions: { allow: [rule] } }),
    ).toHaveLength(1);
  });

  it.each([
    'Bash(pnpm verify)',
    'Bash(pnpm nx run-many:*)',
    'Bash(pnpm new:*)',
    'Bash(pnpm nx show:*)',
  ])('accepts %s', (rule) => {
    expect(checkClaudePermissions({ permissions: { allow: [rule] } })).toEqual(
      [],
    );
  });
});

describe('A2: Claude plugins', () => {
  const marketplace = (ref) => ({
    extraKnownMarketplaces: {
      m: { source: { source: 'github', repo: 'o/r', ...(ref && { ref }) } },
    },
  });

  it('rejects an enabled plugin from an unpinned marketplace', () => {
    expect(
      checkClaudePlugins({ ...marketplace(), enabledPlugins: { 'p@m': true } }),
    ).toHaveLength(1);
  });

  it.each(['v1.2.3', '1.2.3', 'main', 'a'.repeat(39), 'A'.repeat(40)])(
    'rejects a movable or malformed ref %s',
    (ref) => {
      expect(
        checkClaudePlugins({
          ...marketplace(ref),
          enabledPlugins: { 'p@m': true },
        }),
      ).toHaveLength(1);
    },
  );

  it('accepts a pinned commit, or a listed-but-disabled plugin', () => {
    expect(
      checkClaudePlugins({
        ...marketplace('a'.repeat(40)),
        enabledPlugins: { 'p@m': true },
      }),
    ).toEqual([]);
    expect(
      checkClaudePlugins({
        extraKnownMarketplaces: {
          m: {
            source: {
              source: 'github',
              repo: 'o/r',
              ref: 'v1',
              sha: 'b'.repeat(40),
            },
          },
        },
        enabledPlugins: { 'p@m': true },
      }),
    ).toEqual([]);
    expect(
      checkClaudePlugins({
        ...marketplace(),
        enabledPlugins: { 'p@m': false },
      }),
    ).toEqual([]);
  });
});

describe('A3: MCP servers', () => {
  const check = (server) =>
    checkMcpServers([{ where: 'x', servers: { s: server } }]);

  it('accepts lockfile-pinned local servers', () => {
    expect(check({ command: 'pnpm', args: ['exec', 'nx', 'mcp'] })).toEqual([]);
  });

  it.each([
    [{ command: 'npx', args: ['nx', 'mcp'] }],
    [{ command: 'pnpm', args: ['dlx', 'some-mcp'] }],
    [{ command: 'pnpm', args: ['exec', 'x@latest'] }],
    [{ url: 'https://mcp.example.com' }],
    [{ type: 'sse' }],
  ])('rejects %j', (server) => {
    expect(check(server).length).toBeGreaterThan(0);
  });

  it('parses Codex TOML tables', () => {
    const toml =
      '[mcp_servers.nx-mcp]\ncommand = "pnpm"\nargs = [ "exec", "nx", "mcp" ]\n\n[other]\nx = 1\n';
    expect(parseCodexMcpServers(toml)).toEqual({
      'nx-mcp': { command: 'pnpm', args: ['exec', 'nx', 'mcp'] },
    });
  });
});

describe('A6: permission-bypass switches', () => {
  it.each([
    [{ permissions: { defaultMode: 'bypassPermissions' } }, /disables every/],
    [{ permissions: { defaultMode: 'auto' } }, /not one of/],
    [{ permissions: { defaultMode: 'yolo' } }, /not one of/],
    [{ disableAllHooks: true }, /disableAllHooks/],
    [{ disableAllHooks: 'yes' }, /disableAllHooks/],
    [{ skipDangerousModePermissionPrompt: true }, /skipDangerous/],
  ])('Claude: rejects %j', (settings, message) => {
    const problems = checkClaudeSafetySwitches(settings);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(message);
  });

  it.each([
    [{}],
    [{ permissions: { defaultMode: 'default' } }],
    [{ permissions: { defaultMode: 'plan' } }],
    [{ permissions: { defaultMode: 'acceptEdits' } }],
    [{ disableAllHooks: false }],
  ])('Claude: accepts %j', (settings) => {
    expect(checkClaudeSafetySwitches(settings)).toEqual([]);
  });

  it.each([
    [{ mcpServers: { s: { command: 'pnpm', trust: true } } }],
    [{ general: { defaultApprovalMode: 'yolo' } }],
    [{ hooksConfig: { enabled: false } }],
    [{ tools: { allowed: ['run_shell_command(git)'] } }],
    [{ tools: { allowed: ['run_shell_command'] } }],
  ])('Gemini: rejects %j', (settings) => {
    expect(checkGeminiSafetySwitches(settings)).toHaveLength(1);
  });

  it.each([
    [{ mcpServers: { s: { command: 'pnpm', trust: false } } }],
    [{ general: { defaultApprovalMode: 'plan' } }],
    [{ hooksConfig: { enabled: true } }],
    [{ tools: { allowed: ['read_file'] } }],
  ])('Gemini: accepts %j', (settings) => {
    expect(checkGeminiSafetySwitches(settings)).toEqual([]);
  });

  it.each([
    'approval_policy = "never"',
    "sandbox_mode = 'danger-full-access'",
    '[profiles.fast]\napproval_policy = "never"',
    'profiles.fast.sandbox_mode = "danger-full-access" # yolo',
    'approval_policy = { granular = { sandbox_approval = true } }',
  ])('Codex: rejects %j', (toml) => {
    expect(checkCodexSafetySwitches(toml)).toHaveLength(1);
  });

  it.each([
    '',
    'approval_policy = "on-request"\nsandbox_mode = "workspace-write"',
    '[profiles.x]\nsandbox_mode = "read-only"',
  ])('Codex: accepts %j', (toml) => {
    expect(checkCodexSafetySwitches(toml)).toEqual([]);
  });

  /** A git repo whose .claude/settings.local.json enables bypass mode. */
  function repoWithLocalSettings({ commit }) {
    const root = mkdtempSync(join(tmpdir(), 'ai-config-'));
    const git = (...args) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: root,
        stdio: 'ignore',
      });
    git('init', '-q');
    mkdirSync(join(root, '.claude'));
    writeFileSync(
      join(root, '.claude/settings.local.json'),
      JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }),
    );
    if (commit) git('add', '.claude/settings.local.json');
    return root;
  }

  it('checks a committed .claude/settings.local.json', () => {
    expect(checkRepoAiConfig(repoWithLocalSettings({ commit: true }))).toEqual([
      '.claude/settings.local.json: A6: permissions.defaultMode "bypassPermissions" disables every permission check.',
    ]);
  });

  it('ignores a personal, untracked .claude/settings.local.json', () => {
    expect(checkRepoAiConfig(repoWithLocalSettings({ commit: false }))).toEqual(
      [],
    );
  });

  it('checks .claude/settings.json in the repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-config-'));
    mkdirSync(join(root, '.claude'));
    writeFileSync(
      join(root, '.claude/settings.json'),
      JSON.stringify({ disableAllHooks: true }),
    );
    expect(checkRepoAiConfig(root)).toHaveLength(1);
  });
});

describe('this repository', () => {
  it('passes A1-A3 and A6', () => {
    expect(checkRepoAiConfig(resolve(import.meta.dirname, '../../..'))).toEqual(
      [],
    );
  });
});
