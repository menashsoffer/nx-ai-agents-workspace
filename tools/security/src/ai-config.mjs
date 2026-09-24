// A1-A3, A6 (docs/security.md): AI-assistant configuration shipped with the
// repo must not grant arbitrary execution, trust unpinned plugins, run MCP
// servers from outside the lockfile, or switch off permission checks or hooks.
import { spawnSync } from 'node:child_process';
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
  // String prefix of `pnpm nx run-commands`, which runs arbitrary shell commands.
  'pnpm nx run',
];

// Only a full commit SHA is immutable; a tag can be moved after review.
const PINNED_REF = /^[0-9a-f]{40}$/;
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
    } else if (
      ![source.sha, source.ref].some((ref) => PINNED_REF.test(ref ?? ''))
    ) {
      problems.push(
        `A2: plugin "${plugin}" is enabled from marketplace "${marketplace}" without a pinned commit (a full 40-char SHA in "sha" or "ref"; tags can be moved).`,
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

// A6: switches that turn the permission system or hooks off wholesale. Any
// value not known to be safe fails (fail closed).
//
// Claude Code, https://code.claude.com/docs/en/settings-reference:
// `permissions.defaultMode` (#permissions-defaultmode; `bypassPermissions`
// skips every check, `auto` approves through a classifier; current versions
// ignore both from project files, older ones honour them), `disableAllHooks`
// (#disableallhooks) and `skipDangerousModePermissionPrompt`
// (#skipdangerousmodepermissionprompt).
const CLAUDE_SAFE_MODES = ['default', 'ask', 'plan', 'acceptEdits', 'dontAsk'];

export function checkClaudeSafetySwitches(settings) {
  const problems = [];
  const mode = settings?.permissions?.defaultMode;
  if (mode !== undefined && !CLAUDE_SAFE_MODES.includes(mode)) {
    problems.push(
      `A6: permissions.defaultMode "${mode}" ${mode === 'bypassPermissions' ? 'disables every permission check' : `is not one of ${CLAUDE_SAFE_MODES.join(', ')}`}.`,
    );
  }
  if (
    settings?.disableAllHooks !== undefined &&
    settings.disableAllHooks !== false
  ) {
    problems.push(
      'A6: disableAllHooks turns off every hook, including the SessionStart hooks.',
    );
  }
  if (
    settings?.skipDangerousModePermissionPrompt !== undefined &&
    settings.skipDangerousModePermissionPrompt !== false
  ) {
    problems.push(
      'A6: skipDangerousModePermissionPrompt hides the bypassPermissions warning.',
    );
  }
  return problems;
}

// Gemini CLI, https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md:
// `mcpServers.<name>.trust` ("bypass all tool call confirmations"),
// `general.defaultApprovalMode` (`yolo` approves everything),
// `hooksConfig.enabled: false` ("no hooks will be executed") and
// `tools.allowed` (tools that "bypass the confirmation dialog"; shell entries
// there are Gemini's equivalent of an A1 allow-list, which this repo ships
// without).
const GEMINI_SAFE_APPROVAL_MODES = ['default', 'auto_edit', 'plan'];

export function checkGeminiSafetySwitches(settings) {
  const problems = [];
  for (const [name, server] of Object.entries(settings?.mcpServers ?? {})) {
    if (server?.trust !== undefined && server.trust !== false)
      problems.push(
        `A6: .gemini/settings.json MCP server "${name}" has trust enabled (skips every confirmation).`,
      );
  }
  const mode = settings?.general?.defaultApprovalMode;
  if (mode !== undefined && !GEMINI_SAFE_APPROVAL_MODES.includes(mode)) {
    problems.push(
      `A6: .gemini/settings.json general.defaultApprovalMode "${mode}" is not one of ${GEMINI_SAFE_APPROVAL_MODES.join(', ')}.`,
    );
  }
  if (
    settings?.hooksConfig?.enabled !== undefined &&
    settings.hooksConfig.enabled !== true
  ) {
    problems.push(
      'A6: .gemini/settings.json hooksConfig.enabled turns off every hook.',
    );
  }
  for (const tool of settings?.tools?.allowed ?? []) {
    if (/^(run_shell_command|ShellTool)\b/.test(String(tool)))
      problems.push(
        `A6: .gemini/settings.json tools.allowed pre-approves shell commands ("${tool}").`,
      );
  }
  return problems;
}

// Codex has no published config reference reachable from here; the values are
// the serde names in openai/codex codex-rs/protocol (`AskForApproval`:
// untrusted | on-request | on-failure | never | granular; `SandboxMode`:
// read-only | workspace-write | danger-full-access). `never` stops asking and
// `danger-full-access` removes the sandbox. Checked in every table, so
// `[profiles.<name>]` overrides count too.
const CODEX_SAFE = {
  approval_policy: ['untrusted', 'on-request', 'on-failure'],
  sandbox_mode: ['read-only', 'workspace-write'],
};

export function checkCodexSafetySwitches(toml) {
  const problems = [];
  for (const line of toml.split('\n')) {
    const kv =
      /^\s*(?:[\w.-]+\.)?(approval_policy|sandbox_mode)\s*=\s*(.*?)\s*(?:#.*)?$/.exec(
        line,
      );
    if (!kv) continue;
    const value = kv[2].replace(/^["']|["']$/g, '');
    if (!CODEX_SAFE[kv[1]].includes(value)) {
      problems.push(
        `A6: .codex/config.toml ${kv[1]} = ${kv[2]} is not one of ${CODEX_SAFE[kv[1]].join(', ')}.`,
      );
    }
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

/** True when `path` is tracked by git (or when that can't be determined). */
function isCommitted(root, path) {
  if (!existsSync(join(root, path))) return false;
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', path], {
    cwd: root,
    stdio: 'ignore',
  });
  // 1 = untracked; anything else we can't vouch for counts as committed.
  return result.status !== 1;
}

/** Runs A1-A3 and A6 against the repo's real config files. */
export function checkRepoAiConfig(root) {
  const readJson = (path) =>
    existsSync(join(root, path))
      ? JSON.parse(readFileSync(join(root, path), 'utf8'))
      : undefined;
  const readText = (path) =>
    existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '';
  const claudeChecks = (settings) => [
    ...checkClaudePermissions(settings),
    ...checkClaudePlugins(settings),
    ...checkClaudeSafetySwitches(settings),
  ];
  const claude = readJson('.claude/settings.json') ?? {};
  // settings.local.json is personal and gitignored; a committed one is shared
  // config and is held to the same rules.
  const local = '.claude/settings.local.json';
  const gemini = readJson('.gemini/settings.json') ?? {};
  const codex = readText('.codex/config.toml');
  return [
    ...claudeChecks(claude),
    ...(isCommitted(root, local)
      ? claudeChecks(readJson(local)).map((p) => `${local}: ${p}`)
      : []),
    ...checkGeminiSafetySwitches(gemini),
    ...checkCodexSafetySwitches(codex),
    ...checkMcpServers([
      { where: '.mcp.json', servers: readJson('.mcp.json')?.mcpServers },
      { where: '.gemini/settings.json', servers: gemini.mcpServers },
      { where: '.codex/config.toml', servers: parseCodexMcpServers(codex) },
    ]),
  ];
}
