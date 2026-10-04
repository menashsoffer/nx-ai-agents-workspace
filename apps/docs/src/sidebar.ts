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

const DECISIONS_DIRECTORY = 'decisions/';
const DECISIONS_INDEX = `${DECISIONS_DIRECTORY}README.md`;

/** The first `# Heading` of a Markdown file, or the fallback. */
export function extractPageTitle(markdown: string, fallback: string): string {
  return /^# +(.+?) *$/m.exec(markdown)?.[1] ?? fallback;
}

const toSlug = (path: string) => path.replace(/\.md$/, '');
const toLink = (path: string) => `/${toSlug(path)}`;

function getGuideRank(path: string): number {
  const rank = GUIDE_ORDER.indexOf(toSlug(path));
  return rank === -1 ? GUIDE_ORDER.length : rank;
}

/**
 * Sidebar built from the files in `docs/`: the guides in a fixed order, then
 * the decision records by file name. New files show up without config changes.
 */
export function buildSidebar(entries: DocEntry[]): DefaultTheme.SidebarItem[] {
  const guides = entries
    .filter((entry) => !entry.path.includes('/') && entry.path !== 'index.md')
    .sort(
      (first, second) =>
        getGuideRank(first.path) - getGuideRank(second.path) ||
        (first.path < second.path ? -1 : 1),
    )
    .map((entry) => ({
      text:
        GUIDE_LABELS[toSlug(entry.path)] ??
        extractPageTitle(entry.content, toSlug(entry.path)),
      link: toLink(entry.path),
    }));

  const decisions = entries
    .filter((entry) => entry.path.startsWith(DECISIONS_DIRECTORY))
    .sort((first, second) => (first.path < second.path ? -1 : 1))
    .map((entry) =>
      entry.path === DECISIONS_INDEX
        ? { text: 'סקירה', link: `/${DECISIONS_DIRECTORY}` }
        : {
            text: extractPageTitle(entry.content, toSlug(entry.path)),
            link: toLink(entry.path),
          },
    );
  // The overview first, then the records.
  decisions.sort(
    (first, second) =>
      Number(second.text === 'סקירה') - Number(first.text === 'סקירה'),
  );

  return [
    { text: 'מדריכים', items: guides },
    ...(decisions.length
      ? [{ text: 'החלטות ארכיטקטוניות', items: decisions }]
      : []),
  ];
}
