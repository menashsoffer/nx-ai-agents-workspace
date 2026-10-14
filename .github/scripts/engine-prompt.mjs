// Prompt and tool settings built from a validated target profile
// (engine-profile.mjs). The profile is trusted: it sits at a protected path
// on the target's default branch and validateProfile rejects anything
// outside its schema. The issue stays untrusted data (renderPrompt).
//
// Pure: no I/O.
import { promptVersion, renderPrompt } from './pipeline-lib.mjs';
import { ENGINE_PROTECTED_PATHS } from './engine-policy.mjs';
import { PROFILE_PATH } from './engine-profile.mjs';

const commandText = (command) => `\`${command.join(' ')}\``;
const listOrNone = (items) =>
  items.length ? items.map((item) => `- ${item}`).join('\n') : '- (none)';

/** The "Target profile" section placed after the prompt's instructions. */
export function renderProfileSection(profile) {
  const writable = profile.paths.writable;
  return [
    `## Target profile (trusted, from \`${PROFILE_PATH}\` on the default branch)`,
    `- name: ${profile.name}`,
    `- summary: ${profile.summary}`,
    '',
    '### Conventions',
    listOrNone(profile.conventions),
    '',
    '### Verify commands (run by the workflow after you; run them yourself when they are in your allowed commands)',
    listOrNone(profile.commands.verify.map(commandText)),
    '',
    '### Commands you may run',
    listOrNone(profile.agentCommands.map(commandText)),
    '',
    '### Deterministic checks the workflow runs on your change',
    listOrNone(profile.checks.map((name) => `\`${name}\``)),
    '',
    '### Paths',
    `- Protected by the engine (never change): ${ENGINE_PROTECTED_PATHS.map((path) => `\`${path}\``).join(', ')}`,
    `- Protected by the profile (never change): ${profile.paths.protected.map((path) => `\`${path}\``).join(', ') || '(none)'}`,
    writable
      ? `- Writable (the ONLY paths a change may touch): ${writable.map((path) => `\`${path}\``).join(', ')}`
      : '- Writable: any path that is not protected',
    '',
    '### Limits',
    `- at most ${profile.limits.maxFiles} file(s) and ${profile.limits.maxLines} changed lines`,
  ].join('\n');
}

/**
 * The full prompt: the versioned engine prompt, the profile section, the
 * trusted run context (plus `prompt version`, from `promptName` and the
 * prompt's front matter) and the untrusted issue data. Returns `{ prompt,
 * version }`.
 */
export function renderEnginePrompt({
  promptName,
  promptText,
  profile,
  context,
  data,
}) {
  const version = promptVersion(promptText);
  const withProfile = `${promptText.trimEnd()}\n\n${renderProfileSection(profile)}\n`;
  return {
    prompt: renderPrompt({
      promptText: withProfile,
      context: { ...context, 'prompt version': `${promptName}@${version}` },
      data,
    }),
    version,
  };
}

const BASE_DEVELOP_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'MultiEdit',
  'Write',
  'TodoWrite',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(ls:*)',
];

/**
 * The developer's `--allowedTools`: file tools, local git, and exactly the
 * profile's agent commands (each as a prefix rule). No network, push or gh.
 */
export function developAllowedTools(profile) {
  const commands = profile.agentCommands.map(
    (command) => `Bash(${command.join(' ')}:*)`,
  );
  return [...BASE_DEVELOP_TOOLS, ...commands].join(',');
}
