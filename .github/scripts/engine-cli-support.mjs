// Helpers shared by the engine.mjs command modules.
import { readFileSync } from 'node:fs';
import { resolveTarget } from './engine-target.mjs';

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The event payload GitHub wrote for this run (the caller's, in a called workflow). */
export const currentEvent = () =>
  process.env.GITHUB_EVENT_PATH
    ? readJson(process.env.GITHUB_EVENT_PATH)
    : null;

/** The target of this run, from the workflow context only (engine-target.mjs). */
export const currentTarget = (stage) =>
  resolveTarget({ environment: process.env, event: currentEvent(), stage });

/** Prints each problem as a workflow error and exits 1 when there is any. */
export function failOn(problems, title) {
  if (!problems.length) return;
  for (const problem of problems) console.log(`::error::${title}: ${problem}`);
  process.exit(1);
}
