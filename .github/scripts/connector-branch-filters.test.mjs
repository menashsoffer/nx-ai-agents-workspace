// Run: pnpm test:pipeline
// connector-branch-filters.mjs against independent references: the engine
// automaton against isPipelineBranch, and the search against a brute-force
// walk over every engine branch up to a length, with GitHub's filter syntax
// translated to a RegExp on its own (no code shared with the search).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPipelineBranch } from './pipeline-lib.mjs';
import {
  compileFilterPattern,
  findPassingEngineBranch,
  findTriggeringEngineBranch,
  isEngineBranch,
} from './connector-branch-filters.mjs';

/** Every string over `alphabet` of length 0..maxLength. */
function* stringsOver(alphabet, maxLength) {
  yield '';
  if (maxLength === 0) return;
  for (const shorter of stringsOver(alphabet, maxLength - 1))
    if (shorter.length === maxLength - 1)
      for (const character of alphabet) yield shorter + character;
}
const allStrings = (alphabet, maxLength) => {
  const result = [];
  for (let length = 0; length <= maxLength; length++)
    for (const text of stringsOver(alphabet, length))
      if (text.length === length) result.push(text);
  return result;
};

test('branch filters: the automaton accepts exactly isPipelineBranch', () => {
  const tails = allStrings([...'-019az'], 6);
  for (const prefix of ['issue-', 'issue', 'issuf-', 'Issue-', '', 'i'])
    for (const tail of tails) {
      const text = prefix + tail;
      assert.equal(isEngineBranch(text), isPipelineBranch(text), text);
    }
});

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
/** GitHub filter pattern -> RegExp, written apart from the search. */
const referenceRegExp = (pattern) =>
  new RegExp(
    `^${pattern.replace(
      /\\(.)|(\*\*)|(\*)|([?+])|(\[[^\]]+\])|(.)/g,
      (...groups) => {
        const [, escaped, double, single, quantifier, characterClass, other] =
          groups;
        if (escaped !== undefined) return escapeRegExp(escaped);
        if (double) return '.*';
        if (single) return '[^/]*';
        if (quantifier) return quantifier;
        if (characterClass) return characterClass;
        return escapeRegExp(other);
      },
    )}$`,
  );
/** The reference filter: the last matching pattern decides. */
const referenceFilter = (patterns, isIgnoreList) => {
  const compiled = patterns.map((pattern) => {
    const isNegated = pattern.startsWith('!');
    return {
      isNegated,
      expression: referenceRegExp(isNegated ? pattern.slice(1) : pattern),
    };
  });
  return (branch) => {
    let isSelected = false;
    for (const { isNegated, expression } of compiled)
      if (expression.test(branch)) isSelected = !isNegated;
    return isIgnoreList ? !isSelected : isSelected;
  };
};
// every engine branch with a number of up to 3 digits and a slug of up to
// 4 characters over a small alphabet
const BOUNDED_BRANCHES = allStrings([...'01247'], 3)
  .filter((number) => /^[1-9]/.test(number))
  .flatMap((number) =>
    allStrings([...'adocs-'], 4).map((slug) => `issue-${number}-${slug}`),
  )
  .filter(isPipelineBranch);

// [patterns, is branches-ignore]
const FILTERS = [
  [['issue-42-*'], false],
  [['issue-4?2-*'], false],
  [['issue-4+2-*'], false],
  [['issue-[0-9]+-*'], false],
  [['issue-[1-4]-[a-c]'], false],
  [['issue-1*-docs'], false],
  [['*-[a-z]*'], false],
  [['issue-*', '!issue-4*'], false],
  [['issue-*', '!issue-*'], false],
  [['issue-*', '!issue-[1-9]*'], false],
  [['issue-\\4\\2-*'], false],
  [['issue-42'], false],
  [['issue-0*-*'], false],
  [['issue-7-?'], false],
  [['main'], false],
  [[], false],
  [['issue-**'], true],
  [['issue-1*', 'issue-2*', 'issue-4*'], true],
  [['issue-*', '!issue-47-*'], true],
  [['issue-[1-9]*-*'], true],
  [['main'], true],
];

test('branch filters: the search agrees with a brute-force walk', () => {
  for (const [patterns, isIgnoreList] of FILTERS) {
    const label = `${isIgnoreList ? 'ignore' : 'branches'} ${patterns}`;
    const { branch, problems } = findPassingEngineBranch(
      patterns,
      isIgnoreList,
    );
    assert.deepEqual(problems, [], label);
    const passes = referenceFilter(patterns, isIgnoreList);
    const bruteForce = BOUNDED_BRANCHES.find(passes);
    // whatever the walk finds, the search finds, and its answer is real
    if (bruteForce) assert.notEqual(branch, null, label);
    if (branch !== null) {
      assert.ok(isPipelineBranch(branch), `${label}: ${branch}`);
      assert.ok(passes(branch), label);
      // shortest first: never longer than the walk's own answer
      if (bruteForce) assert.ok(branch.length <= bruteForce.length, label);
    } else assert.equal(bruteForce, undefined, label);
  }
});

test('branch filters: the search reaches past any sample length', () => {
  const long = 'issue-1234567-' + 'a'.repeat(30);
  assert.equal(findPassingEngineBranch([long], false).branch, long);
  assert.equal(
    findPassingEngineBranch(['issue-*', `!${long}`], true).branch,
    long,
  );
});

test('branch filters: syntax it does not model is reported, not guessed', () => {
  for (const pattern of ['*?', '**+', '?a', 'issue-[!0]*', 'issue-[0-9', 'a\\'])
    assert.equal(compileFilterPattern(pattern), null, pattern);
  const { branch, problems } = findPassingEngineBranch(
    ['issue-*', '!issue-[!0]*'],
    false,
  );
  assert.equal(branch, null);
  assert.deepEqual(problems, ['cannot read the pattern !issue-[!0]*']);
});

test('branch filters: triggers (create, push, tags only)', () => {
  const branchOf = (triggers) => findTriggeringEngineBranch(triggers).branch;
  assert.equal(branchOf({ create: null }), 'issue-1-a');
  assert.equal(branchOf({ push: null }), 'issue-1-a');
  assert.equal(branchOf({ push: { paths: ['src/**'] } }), 'issue-1-a');
  assert.equal(branchOf({ push: { tags: ['v*'] } }), null);
  assert.equal(branchOf({ push: { 'tags-ignore': ['v*'] } }), null);
  assert.equal(branchOf({ pull_request: null }), null);
  assert.equal(
    branchOf({ push: { branches: ['issue-42-*'], tags: ['v*'] } }),
    'issue-42-a',
  );
});
