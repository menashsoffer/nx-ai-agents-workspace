import { existsSync, globSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { COLOUR_CASES } from './colour-audit.cases.js';
import { EXPORT_CASES } from './export-audit.cases.js';
import {
  hasHardCodedColour,
  parseExportStatements,
} from './conventions-audit.scanner.js';

const uiSourceDirectory = import.meta.dirname;
const indexFilePath = resolve(uiSourceDirectory, 'index.ts');

function parseExportedComponentPaths() {
  const { modules, unrecognisedStatements } = parseExportStatements(
    readFileSync(indexFilePath, 'utf8'),
  );
  return {
    unrecognisedStatements,
    componentPaths: modules
      .filter(({ isTypeOnly }) => !isTypeOnly)
      .map(({ specifier }) => specifier.replace(/^\.\//, '')),
  };
}

describe('parseExportStatements', () => {
  it.each(EXPORT_CASES)(
    '$category: $indexText',
    ({ indexText, modules, unrecognisedStatements }) => {
      expect(parseExportStatements(indexText)).toEqual({
        modules,
        unrecognisedStatements,
      });
    },
  );
});

// AGENTS.md "Definition of done": every libs/ui export needs a spec and a
// story next to it, so a future export that skips either fails this test.
describe('component export coverage', () => {
  const { componentPaths: exportedComponentPaths, unrecognisedStatements } =
    parseExportedComponentPaths();

  it('understands every export statement in index.ts', () => {
    expect(unrecognisedStatements).toEqual([]);
  });

  it('finds components exported from index.ts', () => {
    expect(exportedComponentPaths.length).toBeGreaterThan(0);
  });

  it.each(exportedComponentPaths)(
    '%s has a sibling spec and story file',
    (componentPath) => {
      const componentFilePath = resolve(
        uiSourceDirectory,
        `${componentPath}.tsx`,
      );
      const componentDirectory = dirname(componentFilePath);
      const componentName = basename(componentPath);

      expect(existsSync(componentFilePath)).toBe(true);
      expect(
        existsSync(join(componentDirectory, `${componentName}.spec.tsx`)),
      ).toBe(true);
      expect(
        existsSync(join(componentDirectory, `${componentName}.stories.tsx`)),
      ).toBe(true);
    },
  );
});

describe('hasHardCodedColour', () => {
  it.each(COLOUR_CASES)(
    '$category: $sourceText',
    ({ sourceText, isReported }) => {
      expect(hasHardCodedColour(sourceText)).toBe(isReported);
    },
  );
});

// AGENTS.md "Styling": colours come from the @theme tokens in styles.css,
// never a hard-coded colour literal in a component.
describe('no hard-coded colours', () => {
  const tsxFilePaths = globSync('**/*.tsx', { cwd: uiSourceDirectory });

  it('finds .tsx files to check', () => {
    expect(tsxFilePaths.length).toBeGreaterThan(0);
  });

  it.each(tsxFilePaths)(
    '%s has no hard-coded colour literal',
    (relativePath) => {
      const sourceText = readFileSync(
        resolve(uiSourceDirectory, relativePath),
        'utf8',
      );

      expect(hasHardCodedColour(sourceText)).toBe(false);
    },
  );
});
