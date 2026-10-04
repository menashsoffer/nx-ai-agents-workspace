import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDocEntries } from './docs-source.ts';

describe('readDocEntries', () => {
  it('reads Markdown files recursively with posix relative paths', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'docs-'));
    mkdirSync(join(temporaryDirectory, 'decisions'));
    writeFileSync(join(temporaryDirectory, 'a.md'), '# A');
    writeFileSync(join(temporaryDirectory, 'decisions/0001-b.md'), '# B');
    writeFileSync(join(temporaryDirectory, 'notes.txt'), 'not markdown');

    const entries = readDocEntries(temporaryDirectory).sort((first, second) =>
      first.path < second.path ? -1 : 1,
    );
    expect(entries).toEqual([
      { path: 'a.md', content: '# A' },
      { path: 'decisions/0001-b.md', content: '# B' },
    ]);
  });
});
