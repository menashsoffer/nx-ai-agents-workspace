import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../..');
const readme = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');
const source = readFileSync(
  resolve(projectRoot, 'src/lib/define-app-config.ts'),
  'utf8',
);

/** The two documented behaviors that derive from `port` rather than being passed in. */
const DERIVED_DEFAULTS = new Set(['preview port', 'cacheDir']);

function parseOptionsTableNames(markdown: string): string[] {
  const tableLines = markdown
    .split('\n')
    .filter((line) => /^\s*\|.*\|\s*$/.test(line));
  const isSeparatorRow = (line: string) => /^\s*\|[\s\-:|]+\|\s*$/.test(line);
  const dataRows = tableLines.filter((line) => !isSeparatorRow(line)).slice(1);

  return dataRows.map((line) => {
    const firstCell = line.split('|')[1] ?? '';
    return firstCell.replace(/`/g, '').trim();
  });
}

function parseAppConfigOptionsProperties(sourceText: string): string[] {
  const match = /interface AppConfigOptions \{([\s\S]*?)\n\}/.exec(sourceText);
  if (!match) throw new Error('AppConfigOptions interface not found');

  return match[1]
    .split('\n')
    .map((line) => /^\s*(\w+)\??:/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}

describe('README options table', () => {
  const readmeNames = parseOptionsTableNames(readme);
  const optionProperties = parseAppConfigOptionsProperties(source);

  it('documents at least one option and finds at least one real property', () => {
    expect(readmeNames.length).toBeGreaterThan(0);
    expect(optionProperties.length).toBeGreaterThan(0);
  });

  it.each(readmeNames)(
    'README row "%s" matches an AppConfigOptions property or a derived default',
    (name) => {
      expect(
        optionProperties.includes(name) || DERIVED_DEFAULTS.has(name),
      ).toBe(true);
    },
  );

  it.each(optionProperties)(
    'AppConfigOptions property "%s" has a README row',
    (name) => {
      expect(readmeNames).toContain(name);
    },
  );
});
