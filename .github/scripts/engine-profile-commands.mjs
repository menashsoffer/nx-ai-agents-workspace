// engine.mjs commands that read the target profile (engine-profile.mjs):
// loading it, the prompt, the plan classification, the patch policy, the
// built-in checks and the profile's own commands.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setOutput } from './github.mjs';
import {
  normalizeOutcome,
  parseFlags,
  patchPaths,
  renderPlanComment,
  renderSpecComment,
} from './pipeline-lib.mjs';
import { runChecks } from './engine-checks.mjs';
import { parseExpectations } from './engine-expectations.mjs';
import {
  buildPolicy,
  checkPatchPolicy,
  classifyEnginePlan,
} from './engine-policy.mjs';
import { PROFILE_PATH, validateProfile } from './engine-profile.mjs';
import { failOn, readJson } from './engine-cli-support.mjs';
import { developAllowedTools, renderEnginePrompt } from './engine-prompt.mjs';

const many = (value) => (value === undefined ? [] : [].concat(value));

/**
 * What is at `path` in the checked-out target (cwd), without following
 * symbolic links: also a link in a parent folder counts as a link.
 */
function inspectFile(path) {
  const parts = path.split('/');
  for (let depth = 1; depth <= parts.length; depth++) {
    let status;
    try {
      status = lstatSync(parts.slice(0, depth).join('/'));
    } catch {
      return { kind: 'missing' };
    }
    if (status.isSymbolicLink()) return { kind: 'symlink' };
    if (depth < parts.length && !status.isDirectory()) return { kind: 'other' };
    if (depth === parts.length && !status.isFile()) return { kind: 'other' };
  }
  return { kind: 'file', content: readFileSync(path) };
}

/** Environment for target commands: no tokens, no runner internals. */
const commandEnvironment = () => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CI: 'true',
});

export const profileCommands = {
  // Reads PROFILE_PATH from the target checkout (--target-dir), validates it
  // and writes the normalized profile to --out. Exit 1 when it is missing or
  // invalid. Outputs what the workflow needs from it.
  'load-profile'(args) {
    const flags = parseFlags(args);
    const path = join(flags['target-dir'] ?? '.', PROFILE_PATH);
    if (!existsSync(path)) failOn([`${PROFILE_PATH} is missing`], 'Profile');
    let raw;
    try {
      raw = readJson(path);
    } catch {
      failOn([`${PROFILE_PATH} is not valid JSON`], 'Profile');
    }
    const { profile, problems } = validateProfile(raw);
    failOn(problems, 'Profile');
    writeFileSync(flags.out, JSON.stringify(profile, null, 2));
    setOutput('allowed_tools', developAllowedTools(profile));
    setOutput('has_setup', String(profile.commands.setup.length > 0));
    setOutput('has_checks', String(profile.checks.length > 0));
    setOutput('has_verify', String(profile.commands.verify.length > 0));
  },

  // Engine prompt + profile section + run context + untrusted issue data.
  'render-prompt'(args) {
    const flags = parseFlags(args);
    const context = Object.fromEntries(
      many(flags.context).map((pair) => [
        pair.slice(0, pair.indexOf('=')),
        pair.slice(pair.indexOf('=') + 1),
      ]),
    );
    const { prompt, version } = renderEnginePrompt({
      promptName: basename(flags.prompt),
      promptText: readFileSync(flags.prompt, 'utf8'),
      profile: readJson(flags.profile),
      context,
      data: [
        {
          name: 'issue',
          path: flags.issue,
          content: readFileSync(flags.issue, 'utf8'),
        },
      ],
    });
    setOutput('prompt', prompt);
    setOutput('version', version);
  },

  // Plan outcome against the profile's policy; on success also writes the
  // spec and plan comment bodies.
  'classify-plan'(args) {
    const flags = parseFlags(args);
    const raw = existsSync(flags.result)
      ? readFileSync(flags.result, 'utf8')
      : '';
    const outcome = normalizeOutcome({
      ...classifyEnginePlan({
        jobResult: flags['job-result'],
        raw,
        policy: buildPolicy(readJson(flags.profile)),
      }),
      prompt_version: flags['prompt-version'] ?? '',
    });
    writeFileSync(flags.out, JSON.stringify(outcome));
    if (outcome.result === 'success') {
      const result = JSON.parse(raw);
      writeFileSync(
        flags['spec-out'],
        renderSpecComment(result, flags['prompt-version']),
      );
      writeFileSync(
        flags['plan-out'],
        renderPlanComment(result, flags['prompt-version']),
      );
    }
    setOutput('result', outcome.result);
  },

  // Exit 1 unless the patch fits the policy (engine minimum + profile).
  'check-patch'(args) {
    const flags = parseFlags(args);
    const check = checkPatchPolicy(
      readFileSync(flags._[0], 'utf8'),
      buildPolicy(readJson(flags.profile)),
    );
    if (!check.ok) setOutput('rejected', 'true');
    failOn(check.problems, 'Patch rejected');
  },

  // The engine's checks on the patched target (cwd). --issue is the issue
  // as the GitHub API returned it (for the expected content). Exit 1 on any
  // failure, including a check with nothing to check.
  'run-checks'(args) {
    const flags = parseFlags(args);
    const profile = readJson(flags.profile);
    const { paths } = patchPaths(readFileSync(flags.patch, 'utf8'));
    const parsed = flags.issue
      ? parseExpectations(readJson(flags.issue).body)
      : { expectations: [], problems: [] };
    failOn(parsed.problems, 'Expected content');
    const results = runChecks({
      profile,
      changedPaths: paths,
      inspect: inspectFile,
      expectations: parsed.expectations,
    });
    for (const { name, isPassing, checkedCount } of results)
      console.log(
        `${isPassing ? 'pass' : 'FAIL'} ${name} (${checkedCount} checked)`,
      );
    failOn(
      results.flatMap(({ name, problems }) =>
        problems.map((problem) => `${name}: ${problem}`),
      ),
      'Check',
    );
  },

  // Runs the profile's setup or verify commands in the target (cwd), each
  // as an argv without a shell and without tokens in its environment.
  'run-commands'(args) {
    const flags = parseFlags(args);
    const commands = readJson(flags.profile).commands[flags.kind];
    if (!Array.isArray(commands))
      failOn([`unknown kind ${flags.kind}`], 'Commands');
    for (const [program, ...commandArguments] of commands) {
      console.log(`$ ${[program, ...commandArguments].join(' ')}`);
      execFileSync(program, commandArguments, {
        stdio: 'inherit',
        env: commandEnvironment(),
      });
    }
  },
};
