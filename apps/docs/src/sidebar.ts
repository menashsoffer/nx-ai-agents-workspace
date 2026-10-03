import type { DefaultTheme } from 'vitepress';

/** A Markdown file under `docs/`; `path` is relative to it, with `/`. */
export interface DocEntry {
  path: string;
  content: string;
}

/** Hebrew sidebar labels for the guides; anything else uses its own H1. */
const GUIDE_LABELS: Record<string, string> = {
  architecture: 'ארכיטקטורה',
  conventions: 'קונבנציות',
  pipeline: 'ה-pipeline',
  'pipeline-map': 'מפת ה-pipeline',
  security: 'אבטחה',
};
const GUIDE_ORDER = Object.keys(GUIDE_LABELS);

const DECISIONS_DIR = 'decisions/';
const DECISIONS_INDEX = `${DECISIONS_DIR}README.md`;

/** The first `# Heading` of a Markdown file, or the fallback. */
export function pageTitle(markdown: string, fallback: string): string {
  return /^# +(.+?) *$/m.exec(markdown)?.[1] ?? fallback;
}

const slug = (path: string) => path.replace(/\.md$/, '');
const link = (path: string) => `/${slug(path)}`;

function guideRank(path: string): number {
  const rank = GUIDE_ORDER.indexOf(slug(path));
  return rank === -1 ? GUIDE_ORDER.length : rank;
}

/**
 * Sidebar built from the files in `docs/`: the guides in a fixed order, then
 * the decision records by file name. New files show up without config changes.
 */
export function buildSidebar(entries: DocEntry[]): DefaultTheme.SidebarItem[] {
  const guides = entries
    .filter((e) => !e.path.includes('/') && e.path !== 'index.md')
    .sort(
      (a, b) =>
        guideRank(a.path) - guideRank(b.path) || (a.path < b.path ? -1 : 1),
    )
    .map((e) => ({
      text: GUIDE_LABELS[slug(e.path)] ?? pageTitle(e.content, slug(e.path)),
      link: link(e.path),
    }));

  const decisions = entries
    .filter((e) => e.path.startsWith(DECISIONS_DIR))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((e) =>
      e.path === DECISIONS_INDEX
        ? { text: 'סקירה', link: `/${DECISIONS_DIR}` }
        : { text: pageTitle(e.content, slug(e.path)), link: link(e.path) },
    );
  // The overview first, then the records.
  decisions.sort(
    (a, b) => Number(b.text === 'סקירה') - Number(a.text === 'סקירה'),
  );

  return [
    { text: 'מדריכים', items: guides },
    ...(decisions.length
      ? [{ text: 'החלטות ארכיטקטוניות', items: decisions }]
      : []),
  ];
}
