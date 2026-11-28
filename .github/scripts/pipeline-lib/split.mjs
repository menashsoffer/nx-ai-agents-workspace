// pipeline-lib/split: turns the planner's proposed split of a too-big issue
// into the parts the pipeline opens (see ../pipeline-lib.mjs). Pure.
import { MARKERS } from './constants.mjs';
import { clean } from './outcomes.mjs';
import { neutraliseMarkers } from './comments.mjs';

/** A split has at least two and at most this many parts. */
const SPLIT_MIN_PARTS = 2;

const SPLIT_MAX_PARTS = 6;

const MAX_TITLE = 120;

const MAX_BODY = 6000;

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * The planner's `split` (parts in the order they must be built), cleaned and
 * bounded. Returns `[]` unless it is a well formed list of two to six parts,
 * each with a title and a body: a bad split is dropped as a whole, so the
 * issue then goes to the owner exactly as before.
 */
export function parseSplit(result) {
  const split = result?.split;
  if (!Array.isArray(split)) return [];
  if (split.length < SPLIT_MIN_PARTS || split.length > SPLIT_MAX_PARTS)
    return [];
  if (!split.every((p) => p && isText(p.title) && isText(p.body))) return [];
  return split.map((p) => ({
    title: clean(p.title, MAX_TITLE),
    body: neutraliseMarkers(String(p.body).trim()).slice(0, MAX_BODY),
  }));
}

/** True when an issue body says the pipeline opened it as a part of a split. */
export const isSplitChild = (body) =>
  String(body ?? '').includes(MARKERS.splitChild);

/**
 * The body of part `index` (1-based) of `total`. `previous` is the number of
 * the part that must be built first, or null for the first part.
 */
export function renderChildBody({ parent, index, total, body, previous }) {
  return [
    `${MARKERS.splitChild} parent=${parent} part=${index} -->`,
    `Part ${index} of ${total}, split from #${parent} by the pipeline planner.`,
    previous
      ? `Build it after #${previous} is merged: it relies on that part.`
      : 'This is the first part; nothing has to be built before it.',
    '',
    body,
  ].join('\n');
}

const PART_LINE = /^- part (\d+): #(\d+)\s*$/gm;

/** The part numbers already opened, read back from the split comment. */
export function parseCreatedParts(commentBody) {
  const created = [];
  for (const m of String(commentBody ?? '').matchAll(PART_LINE))
    created[Number(m[1]) - 1] = Number(m[2]);
  return created.filter(Number.isInteger);
}

/** The split comment on the too-big issue: one line per part opened so far. */
export function renderSplitComment({ created, total }) {
  return [
    MARKERS.split,
    `### Split into ${total} parts`,
    '',
    'The planner found the work too big for one pull request and proposed this split. The parts are in `stage:inbox`, in the order they must be built. Qualify them one at a time, after the previous part is merged.',
    '',
    ...created.map((number, i) => `- part ${i + 1}: #${number}`),
    ...(created.length < total
      ? ['', `Opened ${created.length} of ${total} so far.`]
      : []),
  ].join('\n');
}
