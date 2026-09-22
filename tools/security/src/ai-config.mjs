// A1-A3 (docs/security.md): AI-assistant configuration shipped with the repo
// must not grant arbitrary execution, trust unpinned plugins, or run MCP
// servers from outside the lockfile.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Allow-list prefixes that amount to "run anything" once followed by `*`. */
const ARBITRARY_PREFIXES = [
  'pnpm nx',
  'pnpm exec',
  'pnpm dlx',
  'pnpm run',
  'pnpm',
  'npx',
  'pnpx',
  'npm',
  'npm exec',
  'npm run',
  'yarn',
  'bunx',
  'bun',
  'node',
  'sh',
  'bash',
  'zsh',
  'env',
  'xargs',
  'sudo',
  'git',
  'curl',
  'wget',
  'pnpm nx exec',
  'pnpm nx run-commands',
];

const PINNED_REF = /^([0-9a-f]{40}|v?\d+\.\d+\.\d+)$/;
const REMOTE_RUNNERS = ['npx', 'pnpx', 'bunx', 'uvx', 'dlx'];

export function checkClaudePermissions(settings) {
  const problems = [];
  for (const rule of settings?.permissions?.allow ?? []) {
    if (rule === 'Bash' || rule === 'Bash(*)') {
      problems.push(`A1: "${rule}" allows any command.`);
      continue;
    }
    const match = /^Bash\((.*?)(?::\*| \*|\*)\)$/.exec(rule);
    if (match && ARBITRARY_PREFIXES.includes(match[1].trim())) {
      problems.push(
        `A1: "${rule}" allows arbitrary commands; allow specific subcommands instead.`,
      );
    }
  }
  return problems;
}

export function checkClaudePlugins(settings) {
  const problems = [];
  const marketplaces = settings?.extraKnownMarketplaces ?? {};
  for (const [plugin, enabled] of Object.entries(
    settings?.enabledPlugins ?? {},
  )) {
    if (!enabled) continue;
    const marketplace = plugin.split('@')[1];
    const source = marketplaces[marketplace]?.source;
    if (!source) {
      problems.push(
        `A2: plugin "${plugin}" is enabled from an undeclared marketplace.`,
      );
    } else if (!PINNED_REF.test(source.ref ?? '')) {
      problems.push(
        `A2: plugin "${plugin}" is enabled from marketplace "${marketplace}" without a pinned ref (commit SHA or vX.Y.Z tag).`,
      );
    }
  }
  return problems;
}

function checkServer(where, name, { command = '', args = [], url, type }) {
  const problems = [];
  if (url || type === 'http' || type === 'sse') {
    problems.push(
      `A3: ${where} MCP server "${name}" is remote (${url ?? type}); only local, lockfile-pinned servers are allowed.`,
    );
  }
  const words = [command, ...args].map(String);
  if (
    REMOTE_RUNNERS.some(
      (runner) => words.includes(runner) || command.endsWith(`/${runner}`),
    )
  ) {
    problems.push(
      `A3: ${where} MCP server "${name}" runs through ${command} (downloads outside the lockfile); use "pnpm exec".`,
    );
  }
  if (words.some((w) => /@latest$|@next$/.test(w))) {
    problems.push(
      `A3: ${where} MCP server "${name}" uses a floating version tag.`,
    );
  }
  return problems;
}

/** Minimal parser for `[mcp_servers.<name>]` tables with command/args/url keys. */
export function parseCodexMcpServers(toml) {
  const servers = {};
  let current;
  for (const line of toml.split('\n')) {
    const table = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/.exec(line);
    if (table) {
      current = servers[table[1]] = {};
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = undefined;
      continue;
    }
    const kv = /^\s*(command|url|args)\s*=\s*(.+?)\s*$/.exec(line);
    if (current && kv) current[kv[1]] = JSON.parse(kv[2].replace(/'/g, '"'));
  }
  return servers;
}

export function checkMcpServers(sources) {
  return sources.flatMap(({ where, servers }) =>
    Object.entries(servers ?? {}).flatMap(([name, server]) =>
      checkServer(where, name, server),
    ),
  );
}

/** Runs A1-A3 against the repo's real config files. */
export function checkRepoAiConfig(root) {
  const readJson = (path) =>
    existsSync(join(root, path))
      ? JSON.parse(readFileSync(join(root, path), 'utf8'))
      : undefined;
  const claude = readJson('.claude/settings.json') ?? {};
  const codexPath = join(root, '.codex/config.toml');
  return [
    ...checkClaudePermissions(claude),
    ...checkClaudePlugins(claude),
    ...checkMcpServers([
      { where: '.mcp.json', servers: readJson('.mcp.json')?.mcpServers },
      {
        where: '.gemini/settings.json',
        servers: readJson('.gemini/settings.json')?.mcpServers,
      },
      {
        where: '.codex/config.toml',
        servers: existsSync(codexPath)
          ? parseCodexMcpServers(readFileSync(codexPath, 'utf8'))
          : {},
      },
    ]),
  ];
}
