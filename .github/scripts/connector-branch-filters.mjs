// Whether a push of ANY engine branch would start a workflow, decided for
// the whole branch language the engine publishes (`issue-<n>-<slug>`,
// isPipelineBranch in pipeline-lib.mjs), not for a few sample names.
//
// The language is regular (ENGINE_* below is its automaton) and so is
// every GitHub filter pattern (compileFilterPattern). The search walks
// their product breadth first: one state is the engine automaton's state
// plus, per pattern, the set of positions it could be at. Both sides are
// finite, so the walk ends, and it finds a branch that passes the filter
// whenever one exists, the shortest first. Used by connector-coexistence.mjs.
//
// GitHub filter syntax modeled here: `*` (anything but `/`), `**`
// (anything), `?` (zero or one of the character before), `+` (one or more
// of it), `[...]` (one of the listed characters or ranges), `\` (escapes
// the next character), `!` at the start (negates). The last pattern that
// matches decides. A pattern outside this syntax is reported, never
// guessed. A `!` pattern under branches-ignore is read as GitHub reads it
// under branches (a later match re-includes the branch): if GitHub reads
// it otherwise, this check only reports more, never less.

const ALPHABET = [...'abcdefghijklmnopqrstuvwxyz0123456789-'];
const ENGINE_PREFIX = 'issue-';
const ENGINE_START = 0;
const ENGINE_FIRST_DIGIT = ENGINE_PREFIX.length;
const ENGINE_NUMBER = ENGINE_FIRST_DIGIT + 1;
const ENGINE_SLUG_START = ENGINE_NUMBER + 1;
const ENGINE_SLUG = ENGINE_SLUG_START + 1;
/** States the search may visit before it gives up (and says so). */
const MAX_SEARCH_STATES = 100_000;

const isAlphanumeric = (character) => /^[a-z0-9]$/.test(character);

/** The engine branch automaton: the next state, or null for no branch. */
function stepEngine(state, character) {
  if (state < ENGINE_FIRST_DIGIT)
    return character === ENGINE_PREFIX[state] ? state + 1 : null;
  if (state === ENGINE_FIRST_DIGIT)
    return /^[1-9]$/.test(character) ? ENGINE_NUMBER : null;
  if (state === ENGINE_NUMBER) {
    if (/^[0-9]$/.test(character)) return ENGINE_NUMBER;
    return character === '-' ? ENGINE_SLUG_START : null;
  }
  if (isAlphanumeric(character)) return ENGINE_SLUG;
  return state === ENGINE_SLUG && character === '-' ? ENGINE_SLUG_START : null;
}

/** True when the automaton accepts `text`: the same set as isPipelineBranch. */
export function isEngineBranch(text) {
  let state = ENGINE_START;
  for (const character of text) {
    state = stepEngine(state, character);
    if (state === null) return false;
  }
  return state === ENGINE_SLUG;
}

/** `[...]` body -> a character test, or null when it is not modeled. */
function compileCharacterClass(body) {
  if (!body || /^[!^]/.test(body) || body.includes('\\')) return null;
  const tests = [];
  for (let index = 0; index < body.length; index++) {
    const [first, dash, last] = body.slice(index, index + 3);
    if (dash === '-' && last !== undefined) {
      tests.push((character) => character >= first && character <= last);
      index += 2;
    } else tests.push((character) => character === first);
  }
  return (character) => tests.some((test) => test(character));
}

/**
 * One pattern (without its `!`) -> atoms `{ matches, repeat }`, where
 * repeat is `one`, `optional` or `any` (zero or more); null when the
 * pattern is outside the modeled syntax.
 */
export function compileFilterPattern(pattern) {
  const atoms = [];
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') index++;
      // `**` also matches `/`, which no engine branch contains
      atoms.push({ matches: (next) => next !== '/', repeat: 'any' });
    } else if (character === '?' || character === '+') {
      const previous = atoms.at(-1);
      if (previous?.repeat !== 'one') return null;
      if (character === '?') previous.repeat = 'optional';
      else atoms.push({ matches: previous.matches, repeat: 'any' });
    } else if (character === '[') {
      const end = pattern.indexOf(']', index + 1);
      const matches =
        end < 0 ? null : compileCharacterClass(pattern.slice(index + 1, end));
      if (!matches) return null;
      atoms.push({ matches, repeat: 'one' });
      index = end;
    } else {
      let literal = character;
      if (character === '\\') {
        literal = pattern[++index];
        if (literal === undefined) return null;
      }
      atoms.push({ matches: (next) => next === literal, repeat: 'one' });
    }
  }
  return atoms;
}

/** Adds the positions reachable without reading a character. */
function close(atoms, positions) {
  const closed = new Set(positions);
  for (let position = 0; position < atoms.length; position++)
    if (closed.has(position) && atoms[position].repeat !== 'one')
      closed.add(position + 1);
  return closed;
}

function advance(atoms, positions, character) {
  const next = new Set();
  for (const position of positions) {
    const atom = atoms[position];
    if (atom?.matches(character))
      next.add(atom.repeat === 'any' ? position : position + 1);
  }
  return close(atoms, next);
}

const keyOf = (engineState, positionSets) =>
  `${engineState}|${positionSets
    .map((positions) => [...positions].sort((a, b) => a - b).join(','))
    .join(';')}`;

/**
 * The shortest engine branch that passes the filter (`patterns`, as
 * `branches` or, with `isIgnoreList`, as `branches-ignore`), or null when
 * none does. Returns `{ branch, problems }`; with problems, branch is null.
 */
export function findPassingEngineBranch(patterns, isIgnoreList) {
  const compiled = patterns.map((raw) => {
    const text = String(raw);
    const isNegated = text.startsWith('!');
    return {
      text,
      isNegated,
      atoms: compileFilterPattern(isNegated ? text.slice(1) : text),
    };
  });
  const unreadable = compiled.filter(({ atoms }) => atoms === null);
  if (unreadable.length)
    return {
      branch: null,
      problems: unreadable.map(({ text }) => `cannot read the pattern ${text}`),
    };
  const passes = (positionSets) => {
    const last = compiled.findLast(({ atoms }, index) =>
      positionSets[index].has(atoms.length),
    );
    const isSelected = Boolean(last) && !last.isNegated;
    return isIgnoreList ? !isSelected : isSelected;
  };
  const start = compiled.map(({ atoms }) => close(atoms, [0]));
  const queue = [{ engineState: ENGINE_START, positionSets: start, text: '' }];
  const seen = new Set([keyOf(ENGINE_START, start)]);
  for (let head = 0; head < queue.length; head++) {
    const { engineState, positionSets, text } = queue[head];
    if (engineState === ENGINE_SLUG && passes(positionSets))
      return { branch: text, problems: [] };
    for (const character of ALPHABET) {
      const nextEngine = stepEngine(engineState, character);
      if (nextEngine === null) continue;
      const nextSets = compiled.map(({ atoms }, index) =>
        advance(atoms, positionSets[index], character),
      );
      const key = keyOf(nextEngine, nextSets);
      if (seen.has(key)) continue;
      if (seen.size >= MAX_SEARCH_STATES)
        return { branch: null, problems: ['the filter is too large to read'] };
      seen.add(key);
      queue.push({
        engineState: nextEngine,
        positionSets: nextSets,
        text: text + character,
      });
    }
  }
  return { branch: null, problems: [] };
}

/**
 * For a workflow's triggers (`on:` as a map): an engine branch whose push
 * would start it (`create` fires on any new branch; `push` unless its
 * filter leaves every engine branch out, or it only lists tags). Returns
 * `{ branch, problems }`; branch is null when none would.
 */
export function findTriggeringEngineBranch(triggers) {
  if (Object.hasOwn(triggers, 'create'))
    return findPassingEngineBranch([], true);
  if (!Object.hasOwn(triggers, 'push')) return { branch: null, problems: [] };
  const push = triggers.push ?? {};
  const ignored = push['branches-ignore'];
  if (push.branches == null && ignored == null) {
    const isTagsOnly = push.tags != null || push['tags-ignore'] != null;
    return isTagsOnly
      ? { branch: null, problems: [] }
      : findPassingEngineBranch([], true);
  }
  return ignored == null
    ? findPassingEngineBranch([].concat(push.branches), false)
    : findPassingEngineBranch([].concat(ignored), true);
}
