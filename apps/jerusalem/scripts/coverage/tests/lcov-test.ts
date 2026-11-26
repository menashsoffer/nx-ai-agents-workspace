import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mergeReports,
  parseLcov,
  percent,
  relativePath,
  summarize,
  summarizeFile,
} from '../lcov.ts';

const ROOT = '/repo';

function record(path: string, rows: string[]): string {
  return [`SF:${path}`, ...rows, 'end_of_record'].join('\n');
}

const VITEST = [
  record('/repo/web/a.ts', [
    'FN:1,first',
    'FN:5,second',
    'FNDA:1,first',
    'FNDA:0,second',
    'BRF:4',
    'BRH:1',
    'DA:1,1',
    'DA:2,0',
    'DA:5,0',
  ]),
  record('/repo/web/b.ts', ['DA:1,0', 'BRF:0', 'BRH:0']),
].join('\n');

const NODE = [
  record('/repo/web/a.ts', ['FN:5,second', 'FNDA:2,second', 'BRF:2', 'BRH:2', 'DA:2,3']),
  record('/repo/scripts/only-node.ts', ['DA:1,1']),
].join('\r\n');

describe('relativePath', () => {
  it('strips the root with or without a trailing slash', () => {
    assert.equal(relativePath('/repo/web/a.ts', '/repo'), 'web/a.ts');
    assert.equal(relativePath('/repo/web/a.ts', '/repo/'), 'web/a.ts');
  });

  it('normalises Windows separators', () => {
    assert.equal(relativePath('C:\\repo\\web\\a.ts', 'C:\\repo'), 'web/a.ts');
  });

  it('keeps a path outside the root', () => {
    assert.equal(relativePath('/other/a.ts', '/repo'), '/other/a.ts');
  });
});

describe('parseLcov', () => {
  it('reads lines, functions and branches per file', () => {
    const report = parseLcov(VITEST, ROOT);
    const file = report.get('web/a.ts');
    assert.ok(file);
    assert.deepEqual(
      [...file.lines],
      [
        [1, 1],
        [2, 0],
        [5, 0],
      ],
    );
    assert.deepEqual(
      [...file.functions],
      [
        [1, 1],
        [5, 0],
      ],
    );
    assert.equal(file.branchesFound, 4);
    assert.equal(file.branchesHit, 1);
  });

  it('skips a record without a source file and ignores rows without a tag', () => {
    const report = parseLcov(['TN:', 'DA:1,1', 'end_of_record', 'garbage'].join('\n'), ROOT);
    assert.equal(report.size, 0);
  });

  it('keeps function names that contain commas', () => {
    const text = record('/repo/x.ts', ['FN:3,<anonymous, 1>', 'FNDA:4,<anonymous, 1>']);
    assert.deepEqual([...(parseLcov(text, ROOT).get('x.ts')?.functions ?? [])], [[3, 4]]);
  });

  it('treats a function hit row without a count as zero', () => {
    const text = record('/repo/x.ts', ['FN:3,f', 'FNDA:']);
    assert.deepEqual([...(parseLcov(text, ROOT).get('x.ts')?.functions ?? [])], [[3, 0]]);
  });
});

describe('mergeReports', () => {
  const merged = mergeReports(parseLcov(VITEST, ROOT), parseLcov(NODE, ROOT));

  it('counts a line or function as covered when either runner ran it', () => {
    const file = merged.get('web/a.ts');
    assert.ok(file);
    const summary = summarizeFile(file);
    assert.deepEqual(summary.lines, { found: 3, hit: 2 });
    assert.deepEqual(summary.functions, { found: 2, hit: 2 });
  });

  it("uses the better branch share on Vitest's branch count", () => {
    assert.deepEqual(summarizeFile(merged.get('web/a.ts') ?? assert.fail()).branches, {
      found: 4,
      hit: 4,
    });
  });

  it('keeps Vitest files that Node never loaded, and drops Node-only files', () => {
    assert.deepEqual([...merged.keys()], ['web/a.ts', 'web/b.ts']);
  });

  it('treats a file without branches as fully covered when merging', () => {
    const vitest = parseLcov(record('/repo/c.ts', ['BRF:0', 'BRH:0']), ROOT);
    const node = parseLcov(record('/repo/c.ts', ['BRF:2', 'BRH:0']), ROOT);
    assert.equal(mergeReports(vitest, node).get('c.ts')?.branchesHit, 0);
  });
});

describe('summarize and percent', () => {
  it('adds up every file', () => {
    const total = summarize(mergeReports(parseLcov(VITEST, ROOT), parseLcov(NODE, ROOT)));
    assert.deepEqual(total, {
      lines: { found: 4, hit: 2 },
      functions: { found: 2, hit: 2 },
      branches: { found: 4, hit: 4 },
    });
  });

  it('reports 100% when there is nothing to cover', () => {
    assert.equal(percent({ found: 0, hit: 0 }), 100);
    assert.equal(percent({ found: 4, hit: 1 }), 25);
  });
});
