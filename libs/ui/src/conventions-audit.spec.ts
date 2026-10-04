import { existsSync, globSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const uiSourceDirectory = import.meta.dirname;
const indexFilePath = resolve(uiSourceDirectory, 'index.ts');

function parseExportedComponentPaths(): string[] {
  const indexText = readFileSync(indexFilePath, 'utf8');
  return [...indexText.matchAll(/export \* from '(\.\/[^']+)';/g)].map(
    ([, specifier]) => specifier.replace(/^\.\//, ''),
  );
}

// AGENTS.md "Definition of done": every libs/ui export needs a spec and a
// story next to it, so a future export that skips either fails this test.
describe('component export coverage', () => {
  const exportedComponentPaths = parseExportedComponentPaths();

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

const HEX_COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b/;
const RGB_COLOR_PATTERN = /\brgba?\(/i;

// AGENTS.md "Styling": colours come from the @theme tokens in styles.css,
// never a hard-coded hex or rgb()/rgba() literal in a component.
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

      expect(HEX_COLOR_PATTERN.test(sourceText)).toBe(false);
      expect(RGB_COLOR_PATTERN.test(sourceText)).toBe(false);
    },
  );
});
