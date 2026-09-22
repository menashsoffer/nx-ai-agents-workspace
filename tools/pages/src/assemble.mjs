#!/usr/bin/env node
// Builds the GitHub Pages artifact from already-built outputs:
//
//   <out>/            <- apps/site/dist
//   <out>/storybook/  <- libs/ui/storybook-static
//
// Used by both CI (pages-e2e) and the deploy workflow, so what is tested is
// exactly what is deployed. Guards (docs/security.md, docs/architecture.md):
//   - the site must not already contain a reserved top-level path (storybook/)
//   - P1: index.html files load no third-party scripts or styles
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

export const RESERVED_PATHS = ['storybook'];

const workspaceRoot = resolve(fileURLToPath(import.meta.url), '../../../..');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Absolute http(s) or protocol-relative URLs in <script src> / <link href>. */
const EXTERNAL_ASSET =
  /<(?:script[^>]*\ssrc|link[^>]*\shref)=["']((?:https?:)?\/\/[^"']+)["']/gi;

export function assemble({
  siteDir = join(workspaceRoot, 'apps/site/dist'),
  storybookDir = join(workspaceRoot, 'libs/ui/storybook-static'),
  outDir = join(workspaceRoot, 'dist/pages'),
} = {}) {
  for (const [label, dir] of [
    ['site build', siteDir],
    ['Storybook build', storybookDir],
  ]) {
    if (!existsSync(join(dir, 'index.html'))) {
      throw new Error(`${label} not found at ${dir}. Build it first.`);
    }
  }
  for (const reserved of RESERVED_PATHS) {
    if (existsSync(join(siteDir, reserved))) {
      throw new Error(
        `The site build contains "${reserved}/", which the Pages deployment reserves for Storybook. Rename it in apps/site.`,
      );
    }
  }

  rmSync(outDir, { recursive: true, force: true });
  cpSync(siteDir, outDir, { recursive: true });
  cpSync(storybookDir, join(outDir, 'storybook'), { recursive: true });
  writeFileSync(join(outDir, '.nojekyll'), '');

  const problems = [];
  for (const file of walk(outDir)) {
    const rel = relative(outDir, file);
    if (file.endsWith('.map'))
      problems.push(`P2: source map in artifact: ${rel}`);
    if (file.endsWith('.html')) {
      for (const [, url] of readFileSync(file, 'utf8').matchAll(
        EXTERNAL_ASSET,
      )) {
        problems.push(`P1: third-party asset in ${rel}: ${url}`);
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
    const out = assemble();
    console.log(`Pages artifact assembled in ${relative(process.cwd(), out)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
