// Fails when the built site in dist/ is over the size budget. Run after `npm run build:web`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { evaluate, initialScripts } from './budget.ts';

const DIST = 'dist';
const ASSETS = 'assets';

function measure() {
  const pages: Record<string, string[]> = {};
  for (const name of readdirSync(DIST).filter((file) => file.endsWith('.html'))) {
    pages[name] = initialScripts(readFileSync(join(DIST, name), 'utf8'));
  }
  const sizes: Record<string, number> = {};
  for (const name of readdirSync(join(DIST, ASSETS)).filter((file) => file.endsWith('.js'))) {
    const path = `${ASSETS}/${name}`;
    sizes[path] = gzipSync(readFileSync(join(DIST, path))).length;
  }
  return { pages, sizes };
}

const report = evaluate(measure());
for (const line of report.lines) console.log(line);
if (report.failures.length > 0) {
  console.error(`Over the bundle budget:\n${report.failures.join('\n')}`);
  process.exitCode = 1;
}
