#!/usr/bin/env node
// Run once after creating a repo from this template:
//
//   pnpm template:init --scope my-project --what "One line: what this is"
//
// - renames the npm scope (@starter -> @my-project) in every tracked file
// - fills in "## This project" in AGENTS.md (--what, and the GitHub Pages URL
//   derived from `git remote get-url origin`, or --url)
// - removes template-only files (this script, the template smoke test)
// - reinstalls, resets the Nx cache, syncs, regenerates the pipeline map
//   and formats
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

const OLD_SCOPE = 'starter';
const TEMPLATE_ONLY_FILES = [
  'tools/scripts/init-template.mjs',
  'tools/scripts/template-smoke.sh',
  '.github/workflows/template-smoke.yml',
];
const TEMPLATE_ONLY_SCRIPTS = ['template:init', 'template:smoke'];

const { values } = parseArgs({
  options: {
    scope: { type: 'string' },
    what: { type: 'string' },
    url: { type: 'string' },
    help: { type: 'boolean' },
  },
});

const USAGE = `Usage: pnpm template:init --scope <npm-scope> --what "<one line>" [--url <pages-url>]`;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const fail = (message) => {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
};

async function ask(question) {
  if (!process.stdin.isTTY) return undefined;
  const readlineInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = (await readlineInterface.question(question)).trim();
  readlineInterface.close();
  return answer || undefined;
}

/** https://github.com/<owner>/<repo>(.git) or git@github.com:<owner>/<repo>.git -> Pages URL. */
export function pagesUrlFromRemote(remote) {
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    remote.trim(),
  );
  return match
    ? `https://${match[1].toLowerCase()}.github.io/${match[2]}/`
    : undefined;
}

const scope = (values.scope ?? (await ask('npm scope (without @): ')))?.replace(
  /^@/,
  '',
);
if (!scope) fail('Missing --scope.');
if (!/^[a-z0-9][a-z0-9._-]*$/.test(scope)) {
  fail(
    `Invalid scope "${scope}": use lowercase letters, digits, "-", "." or "_".`,
  );
}

const projectDescription =
  values.what ?? (await ask('What is this project (one line)? '));
if (!projectDescription) fail('Missing --what.');

let url = values.url;
if (!url) {
  try {
    url = pagesUrlFromRemote(
      execSync('git remote get-url origin', { encoding: 'utf8' }),
    );
  } catch {
    // no remote configured
  }
}
if (!url)
  fail(
    'Could not derive the GitHub Pages URL from `git remote get-url origin`; pass --url.',
  );

const runCommand = (command) => execSync(command, { stdio: 'inherit' });

// 1. Rename the npm scope in every tracked text file.
const trackedFiles = execSync('git ls-files -z', { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
let changedFileCount = 0;
for (const file of trackedFiles) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (content.includes('\0')) continue; // binary
  const updatedContent = content.replaceAll(`@${OLD_SCOPE}/`, `@${scope}/`);
  if (updatedContent !== content) {
    writeFileSync(file, updatedContent);
    changedFileCount++;
  }
}
console.log(
  `Renamed @${OLD_SCOPE}/ -> @${scope}/ in ${changedFileCount} files.`,
);

// 2. Fill in the project identity in AGENTS.md.
const agentsGuide = readFileSync('AGENTS.md', 'utf8')
  .replace('- **What:** _TODO_', `- **What:** ${projectDescription}`)
  .replace(
    '- **Live:** _TODO_',
    `- **Live:** ${url} (Storybook: ${url}storybook/)`,
  );
writeFileSync('AGENTS.md', agentsGuide);

// 3. Remove template-only files and scripts.
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of TEMPLATE_ONLY_SCRIPTS) delete packageJson.scripts[name];
writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
for (const file of TEMPLATE_ONLY_FILES) rmSync(file, { force: true });

// 4. Reinstall and normalize.
runCommand('pnpm install');
runCommand('pnpm nx reset');
runCommand('pnpm nx sync');
runCommand('pnpm pipeline:map'); // template-smoke.yml is gone from the map
runCommand('pnpm nx format:write --all'); // renamed scope changes Markdown table widths

console.log(`
Done. Next steps (see README "Start a new project"):
  1. Set the site title in apps/site/index.html.
  2. GitHub: Settings -> Pages -> Source: "GitHub Actions".
  3. pnpm verify && git commit -am "Initialize from template"
`);
