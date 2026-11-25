// pipeline-lib/push-guard: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).

// ---------------------------------------------------------------- push guard

/** Glob (GitHub filter syntax, the parts used here) -> anchored RegExp. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * Whether a branch name passes a workflow's `branches` / `branches-ignore`
 * filter (GitHub semantics for one of the two: the last matching pattern
 * wins, `!` negates). No filter at all means every branch.
 */
function branchPasses(filter, branch) {
  if (filter === undefined || filter === null) return true;
  const patterns = [].concat(filter);
  const hit = (list) => list.some((g) => globToRegExp(g).test(branch));
  if (filter.branchesIgnore) return !hit(patterns);
  let passes = false;
  for (const g of patterns) {
    const negated = g.startsWith('!');
    if (globToRegExp(negated ? g.slice(1) : g).test(branch)) passes = !negated;
  }
  return passes;
}

/**
 * The events of a parsed workflow (`on:`) that pushing `branch` would fire
 * with no PR involved: `push` (unless its branch filter leaves the branch
 * out; a `tags`-only filter is not fired by a branch push) and `create`. The
 * approval flow pushes `issue-<n>-<slug>` before any PR exists, so a
 * workflow that fires here would run protected content with repo secrets
 * before the owner approved it. Test: pipeline-lib-protected-status.test.mjs ("push guard").
 */
export function branchPushTriggers(on, branch) {
  let events = {};
  if (typeof on === 'string') events = { [on]: null };
  else if (Array.isArray(on))
    events = Object.fromEntries(on.map((e) => [e, null]));
  else if (on && typeof on === 'object') events = on;
  const hits = [];
  if (Object.hasOwn(events, 'create')) hits.push('create');
  if (Object.hasOwn(events, 'push')) {
    const cfg = events.push ?? {};
    const onlyTags =
      cfg.tags !== undefined &&
      cfg.branches === undefined &&
      cfg['branches-ignore'] === undefined;
    const passes =
      cfg['branches-ignore'] !== undefined
        ? branchPasses(
            Object.assign([].concat(cfg['branches-ignore']), {
              branchesIgnore: true,
            }),
            branch,
          )
        : branchPasses(cfg.branches, branch);
    if (!onlyTags && passes) hits.push('push');
  }
  return hits;
}
