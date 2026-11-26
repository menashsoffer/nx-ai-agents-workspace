// Bundle size budget for the built site (documentation/react-guide-he.md, section 6).

/** JavaScript a page downloads before it can run, gzip bytes. Includes React. */
export const INITIAL_BUDGET_BYTES = 150 * 1024;
/** Each lazily loaded chunk (one screen), gzip bytes. */
export const LAZY_BUDGET_BYTES = 40 * 1024;

const SCRIPT_SRC = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g;
const MODULE_PRELOAD = /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g;

/** Asset paths (as written in the page, relative) of the entry script and its preloads. */
export function initialScripts(html: string): string[] {
  const found = [...html.matchAll(SCRIPT_SRC), ...html.matchAll(MODULE_PRELOAD)];
  return [...new Set(found.map((match) => (match[1] ?? '').replace(/^\.?\//, '')))];
}

export interface Measured {
  /** Page file name mapped to the asset paths it loads first. */
  pages: Record<string, string[]>;
  /** Every JavaScript asset path mapped to its gzip size. */
  sizes: Record<string, number>;
}

export interface Report {
  lines: string[];
  failures: string[];
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;

/** Compares the build with the budget. Any chunk not loaded first by a page counts as lazy. */
export function evaluate({ pages, sizes }: Measured): Report {
  const lines: string[] = [];
  const failures: string[] = [];
  const initial = new Set(Object.values(pages).flat());
  for (const [page, assets] of Object.entries(pages)) {
    const total = assets.reduce((sum, asset) => sum + (sizes[asset] ?? 0), 0);
    lines.push(`${page}: initial JavaScript ${kb(total)} of ${kb(INITIAL_BUDGET_BYTES)}`);
    if (total > INITIAL_BUDGET_BYTES) failures.push(`${page} initial JavaScript is ${kb(total)}`);
  }
  for (const [asset, size] of Object.entries(sizes)) {
    if (initial.has(asset)) continue;
    lines.push(`${asset}: lazy ${kb(size)} of ${kb(LAZY_BUDGET_BYTES)}`);
    if (size > LAZY_BUDGET_BYTES) failures.push(`${asset} is ${kb(size)}`);
  }
  return { lines, failures };
}
