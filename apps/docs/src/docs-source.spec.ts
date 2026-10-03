import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDocEntries } from './docs-source.ts';

describe('readDocEntries', () => {
  it('reads Markdown files recursively with posix relative paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docs-'));
    mkdirSync(join(dir, 'decisions'));
    writeFileSync(join(dir, 'a.md'), '# A');
    writeFileSync(join(dir, 'decisions/0001-b.md'), '# B');
    writeFileSync(join(dir, 'notes.txt'), 'not markdown');

    const entries = readDocEntries(dir).sort((x, y) =>
      x.path < y.path ? -1 : 1,
    );
    expect(entries).toEqual([
      { path: 'a.md', content: '# A' },
      { path: 'decisions/0001-b.md', content: '# B' },
    ]);
  });
});
