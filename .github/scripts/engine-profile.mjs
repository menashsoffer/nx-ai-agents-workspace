// Target profile for the pipeline engine: what a target repository tells the
// engine about itself, at the fixed protected path PROFILE_PATH on its
// default branch. The prompts, the agent's allowed commands and the
// deterministic checks read it instead of assuming Nx, pnpm or React.
//
// validateProfile is strict: an unknown field anywhere, a field that tries to
// steer the engine version, or a command outside the grammar below makes
// the whole profile invalid (fail closed). Pure: no I/O.
import { ENGINE_LIMITS, isPathPattern } from './engine-policy.mjs';

/** Where the profile lives in a target. `.github/` is protected by the engine. */
export const PROFILE_PATH = '.github/pipeline-profile.json';

/** Built-in deterministic checks a profile may ask for (engine-checks.mjs). */
export const CHECK_NAMES = Object.freeze([
  'patch-not-empty',
  'writable-paths',
  'markdown-files',
  'exact-content',
]);

const PROFILE_FIELDS = {
  schema: 'required',
  name: 'required',
  summary: 'required',
  conventions: 'optional',
  commands: 'required',
  agentCommands: 'optional',
  checks: 'optional',
  paths: 'optional',
  limits: 'optional',
};
const COMMAND_FIELDS = { setup: 'optional', verify: 'required' };
const PATH_FIELDS = { protected: 'optional', writable: 'optional' };
const LIMIT_FIELDS = { maxFiles: 'optional', maxLines: 'optional' };

/** A profile may lower the engine's ceilings, never raise them. */
const LIMIT_RANGES = {
  maxFiles: [1, ENGINE_LIMITS.maxFiles],
  maxLines: [1, ENGINE_LIMITS.maxLines],
};

/** Engine settings live in the connector's pin, never in the profile. */
const ENGINE_OVERRIDE = /engine|workflow[-_]?ref|^ref$|^sha$|^commit$/i;

const NAME_FORMAT = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** One command token: no spaces, quotes or shell metacharacters. */
const TOKEN_FORMAT = /^[A-Za-z0-9@%+=:,./_-]{1,200}$/;
const MAX_TEXT = 600;
const MAX_LIST = 20;

/**
 * pnpm subcommands a profile may name. `install` must be frozen. Anything
 * that fetches or runs code outside the repository (dlx, exec, add, ...) is
 * not here, and a script name must not shadow one of them.
 */
const PNPM_SUBCOMMANDS = new Set([
  'install',
  'run',
  'verify',
  'test',
  'lint',
  'build',
  'typecheck',
  'e2e',
  'format',
  'nx',
]);
const PNPM_FORBIDDEN = new Set([
  'dlx',
  'exec',
  'x',
  'add',
  'remove',
  'rm',
  'update',
  'up',
  'publish',
  'config',
  'link',
  'unlink',
  'import',
  'patch',
  'patch-commit',
  'self-update',
  'env',
  'setup',
  'store',
  'server',
  'create',
  'init',
]);
const NODE_SCRIPT = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+\.(?:mjs|js|cjs)$/;

/**
 * Problems with one command (an argv array, run without a shell). Returns
 * an empty list when it is valid. Allowed programs: `node <repo script>`,
 * `pnpm <allowed subcommand or script>`, `corepack enable`.
 */
export function commandProblems(command) {
  if (!Array.isArray(command) || command.length === 0)
    return ['a command must be a non-empty list of tokens'];
  if (command.length > 12) return ['a command has at most 12 tokens'];
  const bad = command.filter(
    (token) => typeof token !== 'string' || !TOKEN_FORMAT.test(token),
  );
  if (bad.length)
    return ['a command token has spaces, quotes or shell characters'];
  if (command.some((token) => token.includes('..')))
    return ['a command token leaves the repository (..)'];
  const [program, first, ...rest] = command;
  if (program === 'node') {
    if (!NODE_SCRIPT.test(first ?? ''))
      return ['node runs only a repository script (no flags such as -e)'];
    return [];
  }
  if (program === 'corepack')
    return command.length === 2 && first === 'enable'
      ? []
      : ['corepack may only run `corepack enable`'];
  if (program !== 'pnpm') return [`program ${program} is not allowed`];
  if (first === undefined || first.startsWith('-'))
    return ['pnpm needs a subcommand first'];
  if (PNPM_FORBIDDEN.has(first)) return [`pnpm ${first} is not allowed`];
  if (!PNPM_SUBCOMMANDS.has(first) && !/^[a-z][a-z0-9:-]*$/.test(first))
    return [`pnpm ${first} is not an allowed subcommand or script name`];
  if (first === 'install' && !rest.includes('--frozen-lockfile'))
    return ['pnpm install needs --frozen-lockfile'];
  if (first === 'run' && PNPM_FORBIDDEN.has(rest[0] ?? ''))
    return [`pnpm run ${rest[0]} is not allowed`];
  return [];
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Unknown and missing fields of one object, against its field table. */
function fieldProblems(value, fields, where) {
  if (!isPlainObject(value)) return [`${where} must be an object`];
  const problems = [];
  for (const key of Object.keys(value)) {
    if (ENGINE_OVERRIDE.test(key))
      problems.push(
        `${where}.${key}: the profile cannot set the engine version (the connector pins it)`,
      );
    else if (!Object.hasOwn(fields, key))
      problems.push(`${where}.${key} is not a known field`);
  }
  for (const [key, need] of Object.entries(fields))
    if (need === 'required' && !Object.hasOwn(value, key))
      problems.push(`${where}.${key} is required`);
  return problems;
}

const isText = (value, max = MAX_TEXT) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[<>`]/.test(value);

function listProblems(value, where, checkItem) {
  if (!Array.isArray(value)) return [`${where} must be a list`];
  if (value.length > MAX_LIST)
    return [`${where} has more than ${MAX_LIST} items`];
  return value.flatMap((item, index) =>
    checkItem(item).map((problem) => `${where}[${index}]: ${problem}`),
  );
}

const textItem = (item) =>
  isText(item, 200) ? [] : ['must be 1-200 characters without < > or `'];
const patternItem = (item) =>
  isPathPattern(item) ? [] : ['is not a repository path pattern'];
const checkItem = (item) =>
  CHECK_NAMES.includes(item) ? [] : [`unknown check ${item}`];

/**
 * Validates a parsed profile. Returns `{ profile, problems }`; `profile` is
 * the normalized profile (defaults filled in) only when there are no
 * problems.
 */
export function validateProfile(raw) {
  const problems = fieldProblems(raw, PROFILE_FIELDS, 'profile');
  if (!isPlainObject(raw)) return { profile: null, problems };
  if (raw.schema !== 1) problems.push('profile.schema must be 1');
  if (!NAME_FORMAT.test(String(raw.name ?? '')))
    problems.push('profile.name must be a lowercase slug');
  if (!isText(raw.summary))
    problems.push(
      `profile.summary must be 1-${MAX_TEXT} characters without < > or \``,
    );
  const conventions = raw.conventions ?? [];
  problems.push(...listProblems(conventions, 'profile.conventions', textItem));
  const commands = raw.commands ?? {};
  problems.push(...fieldProblems(commands, COMMAND_FIELDS, 'profile.commands'));
  const setup = commands.setup ?? [];
  const verify = commands.verify ?? [];
  const agentCommands = raw.agentCommands ?? [];
  problems.push(
    ...listProblems(setup, 'profile.commands.setup', commandProblems),
    ...listProblems(verify, 'profile.commands.verify', commandProblems),
    ...listProblems(agentCommands, 'profile.agentCommands', commandProblems),
  );
  const checks = raw.checks ?? [];
  problems.push(...listProblems(checks, 'profile.checks', checkItem));
  if (
    Array.isArray(verify) &&
    Array.isArray(checks) &&
    !verify.length &&
    !checks.length
  )
    problems.push('the profile needs at least one verify command or check');
  const paths = raw.paths ?? {};
  problems.push(...fieldProblems(paths, PATH_FIELDS, 'profile.paths'));
  const protectedPaths = paths.protected ?? [];
  problems.push(
    ...listProblems(protectedPaths, 'profile.paths.protected', patternItem),
  );
  const writable = paths.writable ?? null;
  if (writable !== null) {
    problems.push(
      ...listProblems(writable, 'profile.paths.writable', patternItem),
    );
    if (Array.isArray(writable) && !writable.length)
      problems.push(
        'profile.paths.writable, when present, lists at least one path',
      );
  }
  if (checks.includes?.('writable-paths') && writable === null)
    problems.push('the writable-paths check needs profile.paths.writable');
  const limits = {
    maxFiles: ENGINE_LIMITS.maxFiles,
    maxLines: ENGINE_LIMITS.maxLines,
    ...(raw.limits ?? {}),
  };
  problems.push(
    ...fieldProblems(raw.limits ?? {}, LIMIT_FIELDS, 'profile.limits'),
  );
  for (const [key, [low, high]] of Object.entries(LIMIT_RANGES))
    if (
      !Number.isInteger(limits[key]) ||
      limits[key] < low ||
      limits[key] > high
    )
      problems.push(
        `profile.limits.${key} must be an integer ${low}-${high} (the engine ceiling)`,
      );
  if (problems.length) return { profile: null, problems };
  return {
    profile: {
      schema: 1,
      name: raw.name,
      summary: raw.summary.trim(),
      conventions,
      commands: { setup, verify },
      agentCommands,
      checks,
      paths: { protected: protectedPaths, writable },
      limits,
    },
    problems,
  };
}
