// Property tests (fast-check) for the pipeline's input-hardening helpers. Each
// property is something that must hold for every input, not only the cases
// someone thought of. Run with: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { neutraliseMarkers } from './pipeline-lib/comments.mjs';
import {
  OUTCOME_STAGES,
  PROBLEMS,
  clean,
  normalizeOutcome,
} from './pipeline-lib/outcomes.mjs';
import { parseOutcome, renderOutcome } from './pipeline-lib.mjs';
import { normalizePath } from './pipeline-lib/patches.mjs';

const MARKER_START = /<!--\s*pipeline/i;

// Text biased towards the characters that matter here.
const hostileText = fc.string({
  unit: fc.constantFrom(
    '<',
    '!',
    '-',
    '>',
    ' ',
    '\n',
    '\t',
    'p',
    'P',
    'a',
    '1',
  ),
  maxLength: 60,
});
const anyText = fc.oneof(hostileText, fc.string({ maxLength: 60 }));

test('neutraliseMarkers: no pipeline marker can survive, in any casing or spacing', () => {
  const marker = fc
    .tuple(
      fc.constantFrom('', ' ', '\n', '\t  '),
      fc.constantFrom('pipeline', 'PIPELINE', 'Pipeline', 'pIpElInE'),
    )
    .map(([space, word]) => `<!--${space}${word}:spec -->`);
  fc.assert(
    fc.property(anyText, marker, anyText, (before, found, after) => {
      assert.doesNotMatch(
        neutraliseMarkers(`${before}${found}${after}`),
        MARKER_START,
      );
    }),
  );
});

test('neutraliseMarkers: idempotent', () => {
  fc.assert(
    fc.property(anyText, (text) => {
      const once = neutraliseMarkers(text);
      assert.equal(neutraliseMarkers(once), once);
    }),
  );
});

test('clean: one line, no HTML comment opener, bounded, idempotent', () => {
  fc.assert(
    fc.property(anyText, fc.integer({ min: 1, max: 80 }), (text, max) => {
      const cleaned = clean(text, max);
      assert.doesNotMatch(cleaned, /[\r\n]/);
      assert.ok(!cleaned.includes('<!--'));
      assert.ok(cleaned.length <= max);
      // Truncation can cut an entity in half, so check idempotence with the
      // limit lifted.
      assert.equal(clean(clean(text, 1000), 1000), clean(text, 1000));
    }),
  );
});

test('normalizePath: a returned path can never leave the repo', () => {
  const segment = fc.constantFrom('a', 'src', '..', '.', '', 'x y', '\0');
  fc.assert(
    fc.property(
      fc.array(segment, { maxLength: 6 }),
      fc.boolean(),
      (segments, isAbsolute) => {
        const input = (isAbsolute ? '/' : '') + segments.join('/');
        const result = normalizePath(input);
        if (result === null) return;
        assert.ok(!result.startsWith('/'));
        assert.ok(!result.includes('\0'));
        assert.ok(!result.includes('//'));
        const parts = result.split('/');
        assert.ok(
          parts.every((part) => part !== '' && part !== '.' && part !== '..'),
        );
        assert.equal(normalizePath(result), result);
      },
    ),
  );
});

test('normalizePath: any path with a parent segment or a leading slash is rejected', () => {
  const safe = fc.constantFrom('a', 'src', 'b.txt');
  fc.assert(
    fc.property(
      fc.array(safe, { maxLength: 3 }),
      fc.array(safe, { maxLength: 3 }),
      (head, tail) => {
        assert.equal(normalizePath([...head, '..', ...tail].join('/')), null);
        assert.equal(normalizePath(`/${[...head, ...tail].join('/')}`), null);
      },
    ),
  );
});

const outcomeInput = fc.record({
  stage: fc.constantFrom(...OUTCOME_STAGES),
  result: fc.constantFrom('success', 'problem', 'other'),
  problem: fc.oneof(fc.constantFrom(...PROBLEMS), anyText),
  summary: anyText,
  questions: fc.array(anyText, { maxLength: 25 }),
  details: fc.array(anyText, { maxLength: 25 }),
  run_url: fc.oneof(
    fc.constant(''),
    fc
      .integer({ min: 1, max: 99999999999 })
      .map((id) => `https://github.com/o/r/actions/runs/${id}`),
  ),
  item: fc.integer({ min: 1, max: 9999 }),
});

test('normalizeOutcome: idempotent', () => {
  fc.assert(
    fc.property(outcomeInput, (input) => {
      const once = normalizeOutcome(input);
      assert.deepEqual(normalizeOutcome(once), once);
    }),
  );
});

test('renderOutcome then parseOutcome returns the normalized outcome', () => {
  fc.assert(
    fc.property(outcomeInput, (input) => {
      const parsed = parseOutcome(renderOutcome(input));
      assert.equal(parsed.ok, true, parsed.error);
      assert.deepEqual(parsed.outcome, normalizeOutcome(input));
    }),
  );
});
