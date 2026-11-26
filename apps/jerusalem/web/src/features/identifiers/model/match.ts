import type { Candidate } from './candidate.ts';

/** How close the registry's name is to ours (screens-spec 7). A hint only, never proof. */
export type MatchLevel = 'same' | 'similar' | 'different';
export const MATCH_LABELS: Record<MatchLevel, string> = {
  same: 'שמות זהים',
  similar: 'שמות דומים',
  different: 'שמות שונים',
};
const ORDER: Record<MatchLevel, number> = { same: 0, similar: 1, different: 2 };
// Legal suffixes say nothing about which company it is.
const NOISE = new Set(['בעמ', 'בע', 'מ', 'עמותה', 'עמותת', 'ltd', 'inc', 'חלצ']);

export function words(name: string): string[] {
  return name
    .normalize('NFKC')
    .toLocaleLowerCase('he')
    .replace(/["'״׳]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word && !NOISE.has(word));
}

export function matchLevel(supplier: string, registered: string | null): MatchLevel {
  if (!registered) return 'different';
  const ours = words(supplier);
  const theirs = words(registered);
  if (ours.join(' ') === theirs.join(' ')) return 'same';
  const shared = ours.filter((word) => theirs.includes(word)).length;
  return shared * 2 >= Math.max(ours.length, theirs.length) ? 'similar' : 'different';
}

/** Splits a name into words, marking those the supplier's own name does not have. */
export function diffWords(name: string, supplier: string): { text: string; differs: boolean }[] {
  const ours = new Set(words(supplier));
  return name
    .split(/(\s+)/)
    .filter(Boolean)
    .map((text) => {
      const [word] = words(text);
      return { text, differs: word !== undefined && !ours.has(word) };
    });
}

export interface Listed {
  candidate: Candidate;
  supplier: string;
  level: MatchLevel;
}
export interface ListFilter {
  source: Candidate['source'] | '';
  query: string;
}
/** Filtered by source and supplier name, closest names first. */
export function listCandidates(rows: Listed[], { source, query }: ListFilter): Listed[] {
  const wanted = words(query);
  return rows
    .filter((row) => !source || row.candidate.source === source)
    .filter((row) => {
      const name = words(row.supplier).join(' ');
      return wanted.every((word) => name.includes(word));
    })
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.supplier.localeCompare(b.supplier, 'he'));
}
