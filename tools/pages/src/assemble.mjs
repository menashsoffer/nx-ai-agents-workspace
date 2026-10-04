#!/usr/bin/env node
// Builds the GitHub Pages artifact from already-built outputs:
//
//   <out>/            <- apps/site/dist
//   <out>/storybook/  <- libs/ui/storybook-static
//   <out>/docs/       <- apps/docs/dist
//
// Used by both CI (pages-e2e) and the deploy workflow, so what is tested is
// exactly what is deployed. Guards (docs/security.md, docs/architecture.md):
//   - the site must not already contain a reserved top-level path (storybook/,
//     docs/) or a PR preview path (pr-<n>/, which the deploy keeps and owns)
//   - P1: no HTML file in the artifact loads a third-party script or style
//   - P2: no source maps in the artifact
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExternalAssets } from './external-assets.mjs';

/** Top-level paths the deployment gives to other builds, with their owner. */
export const RESERVED_PATHS = { storybook: 'Storybook', docs: 'the docs app' };

/** PR previews (preview.yml) live here; a deploy must never write into them. */
const PREVIEW_PATH_PATTERN = /^pr-\d+$/;

const workspaceRoot = resolve(fileURLToPath(import.meta.url), '../../../..');

function* walkFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walkFiles(path);
    else yield path;
  }
}

export function assemble({
  siteDir = join(workspaceRoot, 'apps/site/dist'),
  storybookDir = join(workspaceRoot, 'libs/ui/storybook-static'),
  docsDir = join(workspaceRoot, 'apps/docs/dist'),
  outDir = join(workspaceRoot, 'dist/pages'),
} = {}) {
  for (const [label, buildDirectory] of [
    ['site build', siteDir],
    ['Storybook build', storybookDir],
    ['docs build', docsDir],
  ]) {
    if (!existsSync(join(buildDirectory, 'index.html'))) {
      throw new Error(
        `${label} not found at ${buildDirectory}. Build it first.`,
      );
    }
  }
  for (const [reserved, owner] of Object.entries(RESERVED_PATHS)) {
    if (existsSync(join(siteDir, reserved))) {
      throw new Error(
        `The site build contains "${reserved}/", which the Pages deployment reserves for ${owner}. Rename it in apps/site.`,
      );
    }
  }
  const previewName = readdirSync(siteDir).find((name) =>
    PREVIEW_PATH_PATTERN.test(name),
  );
  if (previewName) {
    throw new Error(
      `The site build contains "${previewName}/", which the Pages deployment keeps for PR previews. Rename it in apps/site.`,
    );
  }

  rmSync(outDir, { recursive: true, force: true });
  cpSync(siteDir, outDir, { recursive: true });
  cpSync(storybookDir, join(outDir, 'storybook'), { recursive: true });
  cpSync(docsDir, join(outDir, 'docs'), { recursive: true });
  writeFileSync(join(outDir, '.nojekyll'), '');

  const problems = [];
  for (const file of walkFiles(outDir)) {
    const relativePath = relative(outDir, file);
    if (file.endsWith('.map'))
      problems.push(`P2: source map in artifact: ${relativePath}`);
    if (file.endsWith('.html')) {
      for (const url of findExternalAssets(readFileSync(file, 'utf8'))) {
        problems.push(`P1: third-party asset in ${relativePath}: ${url}`);
      }
    }
  }
  if (problems.length) {
    throw new Error(
      `Pages artifact failed checks:\n  ${problems.join('\n  ')}`,
    );
  }
  return outDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const outputDirectory = assemble();
    console.log(
      `Pages artifact assembled in ${relative(process.cwd(), outputDirectory)}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
