// What the review screen suggests for each staged row (spec section 7), and the approval summary
// (section 6, step 6). A suggestion is never applied until the admin approves it.
import type { Edited, Issue } from './values.ts';

export interface Candidate {
  id: string;
  name: string;
  /** 1 same verified number, 2 same number waiting for review, 3 same name, 4 similar name. */
  match_rank: number;
}

export type Choice =
  | { decision: 'new' }
  | { decision: 'link'; target: string }
  | { decision: 'hold' }
  | { decision: 'skip'; note: string };

export const MATCH_LABELS: Record<number, string> = {
  1: 'אותו מספר מזהה, מאומת',
  2: 'אותו מספר מזהה, ממתין לבדיקה',
  3: 'אותו שם',
  4: 'שם דומה',
};

/** No candidate: a new supplier. One strong candidate: link to it. Otherwise: wait for review. */
export function suggestion(candidates: readonly Candidate[], issues: readonly Issue[]): Choice {
  if (issues.some((issue) => issue.field === 'name')) return { decision: 'hold' };
  if (candidates.length === 0) return { decision: 'new' };
  const [only] = candidates;
  if (candidates.length === 1 && only && only.match_rank <= 3) {
    return { decision: 'link', target: only.id };
  }
  return { decision: 'hold' };
}

export interface Summary {
  new: number;
  link: number;
  hold: number;
  skip: number;
}

export function summarize(choices: readonly Choice[]): Summary {
  const summary: Summary = { new: 0, link: 0, hold: 0, skip: 0 };
  for (const choice of choices) summary[choice.decision] += 1;
  return summary;
}

/** One staged row on the review screen. `edited` may be corrected; `raw` never changes. */
export interface ReviewRow {
  rowId: number;
  rowNumber: number;
  raw: Record<string, unknown>;
  edited: Edited;
  issues: Issue[];
  candidates: Candidate[];
  choice: Choice;
}

export type Filter = 'all' | 'issues' | 'candidates' | 'hold';

export function matches(row: ReviewRow, filter: Filter): boolean {
  if (filter === 'issues') return row.issues.length > 0;
  if (filter === 'candidates') return row.candidates.length > 0;
  if (filter === 'hold') return row.choice.decision === 'hold';
  return true;
}
