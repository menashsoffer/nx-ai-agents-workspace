#!/usr/bin/env node
// Usage: node tools/pipeline-map/src/cli.mjs [--check]
//   (no flag)  regenerate docs/pipeline-map.md
//   --check    exit 1 when docs/pipeline-map.md is stale
import { relative } from 'node:path';
import { WORKSPACE_ROOT, defaultPaths, run } from './generate.mjs';

const check = process.argv.includes('--check');
const paths = defaultPaths();
const file = relative(WORKSPACE_ROOT, paths.outFile);
const result = await run({ check, ...paths });

if (!check) console.log(`pipeline-map: wrote ${file}`);
else if (result.ok) console.log(`pipeline-map: ${file} is up to date`);
else {
  console.error(
    `pipeline-map: ${file} is stale. Run \`pnpm pipeline:map\` and commit the result.\n` +
      result.diff.map((l) => `  ${l}`).join('\n'),
  );
  process.exitCode = 1;
}
