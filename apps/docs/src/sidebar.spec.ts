import { describe, expect, it } from 'vitest';
import { buildSidebar, extractPageTitle } from './sidebar.ts';

const doc = (path: string, title = path) => ({
  path,
  content: `# ${title}\n\ntext\n`,
});

describe('extractPageTitle', () => {
  it('takes the first H1', () => {
    expect(extractPageTitle('intro\n\n# The title \n\n## Not this', 'x')).toBe(
      'The title',
    );
  });

  it('ignores `#` inside lower-level headings and falls back', () => {
    expect(extractPageTitle('## Only h2\n', 'fallback')).toBe('fallback');
  });
});

describe('buildSidebar', () => {
  it('orders the known guides first, with Hebrew labels', () => {
    const [guides] = buildSidebar([
      doc('security.md'),
      doc('architecture.md'),
      doc('zeta.md', 'Zeta notes'),
      doc('conventions.md'),
    ]);
    expect(guides.text).toBe('מדריכים');
    expect(guides.items).toEqual([
      { text: 'ארכיטקטורה', link: '/architecture' },
      { text: 'קונבנציות', link: '/conventions' },
      { text: 'אבטחה', link: '/security' },
      { text: 'Zeta notes', link: '/zeta' },
    ]);
  });

  it('keeps the landing page out of the sidebar', () => {
    const [guides] = buildSidebar([doc('index.md'), doc('security.md')]);
    expect(guides.items).toHaveLength(1);
  });

  it('lists decisions by file name, overview first, titled by their H1', () => {
    const sidebar = buildSidebar([
      doc('decisions/0002-b.md', '0002. B'),
      doc('decisions/README.md', 'Architecture decision records'),
      doc('decisions/0001-a.md', '0001. A'),
    ]);
    expect(sidebar[1]).toEqual({
      text: 'החלטות ארכיטקטוניות',
      items: [
        { text: 'סקירה', link: '/decisions/' },
        { text: '0001. A', link: '/decisions/0001-a' },
        { text: '0002. B', link: '/decisions/0002-b' },
      ],
    });
  });

  it('omits the decisions group when there are none', () => {
    expect(buildSidebar([doc('security.md')])).toHaveLength(1);
  });
});
