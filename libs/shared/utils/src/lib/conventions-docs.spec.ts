import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  collectConsumedCategories,
  collectSpecCategories,
  readSection,
} from './conventions-docs.scanner.js';

const workspaceRoot = resolve(import.meta.dirname, '../../../../..');
const conventionsText = readFileSync(
  resolve(workspaceRoot, 'docs/conventions.md'),
  'utf8',
);

// Each audit is the `describe` of a spec that runs `it.each` fixture tables;
// the categories are read from wherever those tables are written.
const AUDITS = [
  {
    heading: 'RTL audit',
    specPath: 'libs/shared/utils/src/lib/conventions-audit.spec.ts',
    describeTitle: 'findPhysicalCssProperties',
  },
  {
    heading: 'Colour audit',
    specPath: 'libs/ui/src/conventions-audit.spec.ts',
    describeTitle: 'hasHardCodedColour',
  },
  {
    heading: 'Export coverage audit',
    specPath: 'libs/ui/src/conventions-audit.spec.ts',
    describeTitle: 'parseExportStatements',
  },
];

const isDocumented = (section: string | undefined, category: string) =>
  Boolean(section?.includes(`\`${category}\``));

describe('docs/conventions.md describes the convention audits', () => {
  it.each(AUDITS)(
    '"$heading" names every category $describeTitle runs',
    ({ heading, specPath, describeTitle }) => {
      const section = readSection(conventionsText, heading);
      const categories = collectConsumedCategories(
        resolve(workspaceRoot, specPath),
        describeTitle,
      );

      expect(section).toBeDefined();
      expect(categories.length).toBeGreaterThan(0);
      expect(
        categories.filter((category) => !isDocumented(section, category)),
      ).toEqual([]);
    },
  );

  it.each([...new Set(AUDITS.map(({ specPath }) => specPath))])(
    'every category in %s or its cases files is documented by an audit of that spec',
    (specPath) => {
      const sections = AUDITS.filter(
        (audit) => audit.specPath === specPath,
      ).map(({ heading }) => readSection(conventionsText, heading));
      const categories = collectSpecCategories(
        resolve(workspaceRoot, specPath),
      );

      expect(
        categories.filter(
          (category) =>
            !sections.some((section) => isDocumented(section, category)),
        ),
      ).toEqual([]);
    },
  );
});

describe('category extraction', () => {
  const specPath = '/audit/example.spec.ts';
  const readFrom = (files: Record<string, string>) => (path: string) =>
    files[path];

  it('reads double-quoted categories from a table written in the spec', () => {
    const read = readFrom({
      [specPath]: `describe("audit", () => {
        it.each([{ category: "double quoted" }, { category: \`template\` }])("x", () => {});
      });`,
    });
    expect(collectConsumedCategories(specPath, 'audit', read)).toEqual([
      'double quoted',
      'template',
    ]);
  });

  it('reads categories from an imported table, including a helper in that file', () => {
    const read = readFrom({
      [specPath]: `import { CASES } from './example.cases.js';
        describe('audit', () => { it.each(CASES)('x', () => {}); });
        describe('other', () => { it.each([{ category: 'elsewhere' }])('y', () => {}); });`,
      '/audit/example.cases.ts': `const make = (name) => ({ category: "helper", name });
        export const CASES = [make('a'), { category: 'plain' }];`,
    });
    expect(collectConsumedCategories(specPath, 'audit', read)).toEqual([
      'helper',
      'plain',
    ]);
    expect(collectSpecCategories(specPath, read)).toEqual(
      expect.arrayContaining(['elsewhere', 'helper', 'plain']),
    );
  });

  it('names a category that is not a literal, and a missing table', () => {
    const read = readFrom({
      [specPath]: `describe('audit', () => { it.each([{ category: pick() }])('x', () => {}); });
        describe('empty', () => { it('y', () => {}); });`,
    });
    expect(collectConsumedCategories(specPath, 'audit', read)[0]).toMatch(
      /^<non-literal category: pick\(\)>/,
    );
    expect(() => collectConsumedCategories(specPath, 'empty', read)).toThrow(
      /no it\.each table/,
    );
    expect(() => collectConsumedCategories(specPath, 'absent', read)).toThrow(
      /no top-level describe/,
    );
  });

  it('reads a section up to the next heading', () => {
    expect(readSection('## A\n### B\ntext `x`\n\n### C\nmore', 'B')).toBe(
      '### B\ntext `x`\n',
    );
    expect(readSection('## A\n', 'B')).toBeUndefined();
  });
});
