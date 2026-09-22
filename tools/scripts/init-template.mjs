#!/usr/bin/env node
// Run once after creating a repo from this template:
//
//   pnpm template:init --scope my-project
//
// Renames the npm scope (@starter -> @my-project) in every tracked file,
// reinstalls, resets the Nx cache and removes itself.
import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const OLD_SCOPE = 'starter';

const { values } = parseArgs({
  options: { scope: { type: 'string' }, help: { type: 'boolean' } },
});

if (values.help || !values.scope) {
  console.log('Usage: pnpm template:init --scope <npm-scope-without-@>');
  process.exit(values.help ? 0 : 1);
}

const scope = values.scope.replace(/^@/, '');
if (!/^[a-z0-9][a-z0-9._-]*$/.test(scope)) {
  console.error(
    `Invalid scope "${scope}": use lowercase letters, digits, "-", "." or "_".`,
  );
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const files = execSync('git ls-files -z', { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let changed = 0;
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted or unreadable
  }
  if (content.includes('\0')) continue; // binary
  const next = content.replaceAll(`@${OLD_SCOPE}/`, `@${scope}/`);
  if (next !== content) {
    writeFileSync(file, next);
    changed++;
  }
}
console.log(`Renamed @${OLD_SCOPE}/ -> @${scope}/ in ${changed} files.`);

// The script is single-use: drop it and its package.json entry.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
delete pkg.scripts['template:init'];
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
rmSync(new URL(import.meta.url));

run('pnpm install');
run('pnpm nx reset');
run('pnpm nx sync');
run('pnpm nx format:write --all'); // renamed scope changes Markdown table widths

console.log(`
Done. Next steps:
  1. Fill in "## This project" at the top of AGENTS.md.
  2. Set the site title in apps/site/index.html.
  3. GitHub: Settings -> Pages -> Source: "GitHub Actions".
  4. pnpm verify && git commit -am "Initialize from template"
`);
