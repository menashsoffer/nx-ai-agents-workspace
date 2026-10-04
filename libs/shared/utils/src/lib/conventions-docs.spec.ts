import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '../../../../..');

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
}

/** The text of a `###` section, up to the next heading of any level. */
function readSection(markdown: string, heading: string): string | undefined {
  const start = markdown.indexOf(`\n### ${heading}\n`);
  if (start === -1) return undefined;
  const body = markdown.slice(start + 1).split('\n');
  const end = body.findIndex(
    (line, index) => index > 0 && /^#{1,3} /.test(line),
  );
  return body.slice(0, end === -1 ? undefined : end).join('\n');
}

// Each audit's fixture categories are listed in its `*.cases.ts`. They are
// read as text, like every other workspace file the audits read, so no import
// crosses a project boundary.
const AUDITS = [
  {
    heading: 'RTL audit',
    casesPath: 'libs/shared/utils/src/lib/physical-css.cases.ts',
  },
  { heading: 'Colour audit', casesPath: 'libs/ui/src/colour-audit.cases.ts' },
  {
    heading: 'Export coverage audit',
    casesPath: 'libs/ui/src/export-audit.cases.ts',
  },
];

describe('docs/conventions.md describes the convention audits', () => {
  const conventionsText = readWorkspaceFile('docs/conventions.md');

  it.each(AUDITS)(
    '"$heading" names every fixture category of $casesPath',
    ({ heading, casesPath }) => {
      const section = readSection(conventionsText, heading);
      const categories = [
        ...new Set(
          [
            ...readWorkspaceFile(casesPath).matchAll(/category: '([^']+)'/g),
          ].map(([, category]) => category),
        ),
      ];

      expect(section).toBeDefined();
      expect(categories.length).toBeGreaterThan(0);
      expect(
        categories.filter((category) => !section?.includes(`\`${category}\``)),
      ).toEqual([]);
    },
  );

  it('keeps the section check honest: a missing heading or category is found', () => {
    expect(readSection('## A\n\n### B\ntext `x`\n\n### C\nmore', 'B')).toBe(
      '### B\ntext `x`\n',
    );
    expect(readSection('## A\n', 'B')).toBeUndefined();
  });
});
