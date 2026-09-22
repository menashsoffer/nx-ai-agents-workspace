import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkClaudePermissions,
  checkClaudePlugins,
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

  it('accepts a pinned tag or commit, or a listed-but-disabled plugin', () => {
    expect(
      checkClaudePlugins({
        ...marketplace('v1.2.3'),
        enabledPlugins: { 'p@m': true },
      }),
    ).toEqual([]);
    expect(
      checkClaudePlugins({
        ...marketplace('a'.repeat(40)),
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

describe('this repository', () => {
  it('passes A1-A3', () => {
    expect(checkRepoAiConfig(resolve(import.meta.dirname, '../../..'))).toEqual(
      [],
    );
  });
});
