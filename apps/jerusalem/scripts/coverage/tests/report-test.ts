import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Report } from '../lcov.ts';
import { formatReport, type Thresholds } from '../report.ts';
import { mergeCalls, parseCalls, uncalled } from '../sql.ts';

const THRESHOLDS: Thresholds = { lines: 90, branches: 90, functions: 90, sqlFunctions: 90 };

function file(lineHits: number[], branches: [number, number] = [0, 0]) {
  return {
    lines: new Map(lineHits.map((hits, index) => [index + 1, hits])),
    functions: new Map([[1, lineHits[0] ?? 0]]),
    branchesFound: branches[0],
    branchesHit: branches[1],
  };
}

describe('formatReport', () => {
  it('passes and lists no files when everything is covered', () => {
    const report: Report = new Map([['web/a.ts', file([1, 1], [2, 2])]]);
    const result = formatReport(report, new Map([['public.f()', 1]]), THRESHOLDS);
    assert.deepEqual(result.failures, []);
    assert.match(result.text, /\| All \| 100\.0% \(2\/2\) \| 100\.0% \(2\/2\)/);
    assert.doesNotMatch(result.text, /Files below/);
    assert.doesNotMatch(result.text, /SQL functions no test calls/);
  });

  it('fails each metric under its threshold and lists the weakest files first', () => {
    const report: Report = new Map([
      ['web/good.ts', file([1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1])],
      ['web/half.ts', file([1, 0], [2, 1])],
      ['web/none.ts', file([0, 0], [2, 0])],
    ]);
    const calls = new Map([
      ['public.f()', 0],
      ['private.g()', 3],
    ]);
    const result = formatReport(report, calls, THRESHOLDS);
    assert.deepEqual(result.failures, [
      'lines: 76.92% < 90%',
      'branches: 40.00% < 90%',
      'functions: 66.67% < 90%',
      'SQL functions: 50.00% < 90%',
    ]);
    const none = result.text.indexOf('web/none.ts');
    const half = result.text.indexOf('web/half.ts');
    assert.ok(none > 0 && half > none, 'the least covered file comes first');
    assert.doesNotMatch(result.text, /web\/good\.ts/);
    assert.match(result.text, /- `public\.f\(\)`/);
  });
});

describe('SQL call counts', () => {
  it('parses a dump written by the test databases', () => {
    assert.deepEqual(parseCalls('[{"name":"public.f()","calls":2}]'), [
      { name: 'public.f()', calls: 2 },
    ]);
  });

  it('rejects anything that is not a list of named counts', () => {
    assert.throws(() => parseCalls('{}'), /not a list/);
    assert.throws(() => parseCalls('[null]'), /Bad SQL coverage row/);
    assert.throws(() => parseCalls('[1]'), /Bad SQL coverage row/);
    assert.throws(() => parseCalls('[{"name":"f","calls":"1"}]'), /Bad SQL coverage row/);
    assert.throws(() => parseCalls('[{"calls":1}]'), /Bad SQL coverage row/);
  });

  it('adds the calls of every database and lists the functions nobody called', () => {
    const merged = mergeCalls([
      [
        { name: 'public.b()', calls: 0 },
        { name: 'public.a()', calls: 0 },
      ],
      [
        { name: 'public.b()', calls: 2 },
        { name: 'public.c()', calls: 0 },
      ],
    ]);
    assert.deepEqual(uncalled(merged), ['public.a()', 'public.c()']);
    assert.equal(merged.get('public.b()'), 2);
  });

  it('counts calls in an older database but not the functions only it still has', () => {
    const merged = mergeCalls(
      [[{ name: 'public.a()', calls: 0 }]],
      [
        [
          { name: 'public.a()', calls: 1 },
          { name: 'public.dropped(int)', calls: 0 },
        ],
      ],
    );
    assert.deepEqual([...merged], [['public.a()', 1]]);
  });
});
