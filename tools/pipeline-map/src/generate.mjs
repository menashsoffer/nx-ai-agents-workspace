// File I/O around the pure model: read the sources, render, format with the
// repo's Prettier, and write or compare docs/pipeline-map.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { buildModel } from './model.mjs';
import { renderMarkdown } from './render.mjs';
import { readWorkflows } from './workflows.mjs';

export const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');

export function defaultPaths(root = WORKSPACE_ROOT) {
  return {
    workflowsDir: join(root, '.github/workflows'),
    // Imported by path at runtime: .github/ is not an Nx project.
    libPath: join(root, '.github/scripts/pipeline-lib.mjs'),
    outFile: join(root, 'docs/pipeline-map.md'),
  };
}

/**
 * @typedef {object} Paths
 * @property {string} workflowsDir
 * @property {string} libPath
 * @property {string} outFile
 * @property {object} [expectedUngated] defaults to config.mjs
 */

/**
 * Rendered, Prettier-formatted Markdown for the given sources.
 * @param {Paths} paths
 */
export async function generate({
  workflowsDir,
  libPath,
  outFile,
  expectedUngated,
}) {
  const lib = await import(pathToFileURL(libPath).href);
  const model = buildModel({
    workflows: readWorkflows(workflowsDir),
    lib,
    expectedUngated,
  });
  const config = (await prettier.resolveConfig(outFile)) ?? {};
  return prettier.format(renderMarkdown(model), {
    ...config,
    filepath: outFile,
  });
}

/**
 * Writes `outFile`, or with `check` compares it and reports staleness.
 * Returns `{ ok, stale, diff }`.
 * @param {Paths & { check?: boolean }} options
 */
export async function run({ check = false, ...paths }) {
  const next = await generate(paths);
  const current = existsSync(paths.outFile)
    ? readFileSync(paths.outFile, 'utf8')
    : null;
  if (!check) {
    if (current !== next) writeFileSync(paths.outFile, next);
    return { ok: true, stale: false, diff: [] };
  }
  const stale = current !== next;
  return {
    ok: !stale,
    stale,
    diff: stale ? lineDiff(current ?? '', next) : [],
  };
}

/** First few differing lines, enough to point at what changed. */
export function lineDiff(a, b, max = 8) {
  const x = a.split('\n');
  const y = b.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(x.length, y.length) && out.length < max; i++) {
    if (x[i] === y[i]) continue;
    if (x[i] !== undefined) out.push(`${i + 1}: - ${x[i]}`);
    if (y[i] !== undefined) out.push(`${i + 1}: + ${y[i]}`);
  }
  return out;
}
