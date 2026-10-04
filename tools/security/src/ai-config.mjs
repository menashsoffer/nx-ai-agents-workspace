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
// A1: wildcard rules that let the agent pick which project-defined task or
// generator runs, or pass extra arguments through to one (`pnpm new:app:*`
// forwards `--config x.ts`-style flags; `pnpm nx test:*` accepts any project
// and runner flags). Task definitions are pinned by A7, but the code those
// runners load is agent-editable, so only fixed commands may be pre-approved.
// Nx subcommands that only read the workspace (or run the formatter, whose
// config is JSON) may keep a wildcard.
const NX_WILDCARD_SAFE = ['show', 'graph', 'format:write', 'format:check'];

function runsProjectTasks(prefix) {
  const words = prefix.split(/\s+/);
  const nx =
    words[0] === 'nx' ? 1 : words[0] === 'pnpm' && words[1] === 'nx' ? 2 : -1;
  if (nx !== -1) return !NX_WILDCARD_SAFE.includes(words[nx] ?? '');
  // `pnpm <script> …`: runs a package script with agent-chosen arguments.
  return words[0] === 'pnpm';
}

// A deny-list can't name every interpreter, so a rule whose command is one of
// these and has nothing but options after it (`bash -c`, `python3`, `find`,
// `git -c`) is "run anything" too. A rule that names a script or subcommand
// (`node scripts/x.mjs`) is a specific command and stays allowed.
const GENERIC_EXECUTORS = new Set([
  ...['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'busybox', 'eval', 'exec'],
  ...['node', 'deno', 'bun', 'python', 'python3', 'perl', 'ruby', 'php', 'lua'],
  ...['awk', 'gawk', 'find', 'xargs', 'env', 'sudo', 'make', 'nohup', 'ssh'],
  ...['timeout', 'git', 'npm', 'yarn', 'pnpm', 'curl', 'wget'],
]);

function runsAnything(prefix) {
  if (prefix === '' || /^\*+$/.test(prefix)) return true;
  if (ARBITRARY_PREFIXES.includes(prefix)) return true;
  const [command, ...rest] = prefix.split(/\s+/);
  return GENERIC_EXECUTORS.has(command) && rest.every((w) => w.startsWith('-'));
}

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
    if (!match) continue;
    const prefix = match[1].trim();
    if (runsAnything(prefix)) {
      problems.push(
        `A1: "${rule}" allows arbitrary commands; allow specific subcommands instead.`,
      );
    } else if (runsProjectTasks(prefix)) {
      problems.push(
        `A1: "${rule}" lets the agent choose project tasks, generators or their arguments; pre-approve fixed commands (e.g. "Bash(pnpm verify)") instead.`,
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

function checkServer(
  where,
  name,
  { command = '', args = [], url, type, unparsed },
) {
  const problems = [];
  if (unparsed) {
    problems.push(
      `A3: ${where} MCP server "${name}" is written in a form this check cannot read (${unparsed}); use a [mcp_servers.<name>] table with command, args and url.`,
    );
  }
  if (url || type === 'http' || type === 'sse') {
    problems.push(
      `A3: ${where} MCP server "${name}" is remote (${url ?? type}); only local, lockfile-pinned servers are allowed.`,
    );
  }
  // Split every argument into words too, so `bash -c "npx x"` is seen.
  const words = [command, ...args]
    .map(String)
    .flatMap((w) => w.split(/\s+/))
    .filter(Boolean);
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

/** The line without its `# comment` (a `#` inside a quoted string stays). */
function stripTomlComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

// Finds the keys anywhere on a line, not only at its start, so inline tables
// (`profiles.x = { approval_policy = "never" }`), dotted keys and quoted keys
// are checked too.
const CODEX_SWITCH =
  /(?:^|[\s,{.])["']?(approval_policy|sandbox_mode)["']?\s*=\s*("[^"]*"|'[^']*'|[^\s,}]+)/g;

export function checkCodexSafetySwitches(toml) {
  const problems = [];
  for (const line of toml.split('\n')) {
    for (const kv of stripTomlComment(line).matchAll(CODEX_SWITCH)) {
      const value = kv[2].replace(/^["']|["']$/g, '');
      if (!CODEX_SAFE[kv[1]].includes(value)) {
        problems.push(
          `A6: .codex/config.toml ${kv[1]} = ${kv[2]} is not one of ${CODEX_SAFE[kv[1]].join(', ')}.`,
        );
      }
    }
  }
  return problems;
}

/**
 * Minimal parser for `[mcp_servers.<name>]` tables with command/args/url keys
 * (arrays may span lines). Anything it cannot read (inline tables, dotted
 * keys, values that are not JSON-compatible) is recorded as `unparsed`, which
 * A3 reports, rather than being skipped or crashing the run.
 */
export function parseCodexMcpServers(toml) {
  const servers = {};
  let current;
  const lines = toml.split('\n').map(stripTomlComment);
  const open = (text) => (text.match(/\[/g) ?? []).length;
  const close = (text) => (text.match(/\]/g) ?? []).length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const table = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/.exec(line);
    if (table) {
      current = servers[table[1]] = {};
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = undefined;
      continue;
    }
    const dotted = /^\s*"?mcp_servers"?(?:\.([\w-]+|"[^"]+"))?\s*=/.exec(line);
    if (dotted) {
      servers[dotted[1] ?? '(mcp_servers)'] = { unparsed: line.trim() };
      continue;
    }
    const kv = /^\s*(command|url|args)\s*=\s*(.*?)\s*$/.exec(line);
    if (!current || !kv) continue;
    let value = kv[2];
    while (open(value) > close(value) && i + 1 < lines.length) {
      value += `\n${lines[++i]}`;
    }
    try {
      current[kv[1]] = JSON.parse(
        value.replace(/'/g, '"').replace(/,\s*\]/g, ']'),
      );
    } catch {
      current.unparsed = `${kv[1]} = ${value.replace(/\s+/g, ' ')}`;
    }
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
  const codex = readText('.codex/config.toml');
  return [
    ...claudeChecks(claude),
    ...(isCommitted(root, local)
      ? claudeChecks(readJson(local)).map((p) => `${local}: ${p}`)
      : []),
    ...checkCodexSafetySwitches(codex),
    ...checkMcpServers([
      { where: '.mcp.json', servers: readJson('.mcp.json')?.mcpServers },
      { where: '.codex/config.toml', servers: parseCodexMcpServers(codex) },
    ]),
  ];
}
