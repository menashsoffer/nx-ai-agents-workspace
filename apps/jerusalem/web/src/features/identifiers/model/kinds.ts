import { z } from '../../../data/zod.ts';
import { SCHEMES } from './candidate.ts';

const reasonSchema = z.object({
  source: z.enum(['registry', 'identifier', 'name']),
  scheme: z.enum(['company', 'nonprofit', 'vat_dealer', 'personal_id']).optional(),
  value: z.string().optional(),
  kind: z.string(),
});
export const kindSuggestionSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  suggested_kind: z.string(),
  strength: z.enum(['strong', 'medium']),
  reasons: z.array(reasonSchema),
});
export type KindSuggestion = z.infer<typeof kindSuggestionSchema>;
type Reason = KindSuggestion['reasons'][number];

// The kind names of the supplier screen (features/supplier/model/labels.ts). Kept here rather
// than shared: a module shared by two lazy screens becomes its own chunk, and every chunk
// adds to the first load, which is at its budget.
const KINDS: Record<string, string> = {
  company: 'חברה',
  sole_trader: 'עוסק',
  nonprofit: 'עמותה',
  partnership: 'שותפות',
  public_body: 'גוף ציבורי',
  cooperative: 'אגודה שיתופית',
};

export const STRENGTHS = { strong: 'רמז חזק', medium: 'רמז בינוני' };

export const kindLabel = (kind: string) => KINDS[kind] ?? kind;

/** One reason in a sentence (spec section 3): where the hint came from and what it says. */
export function reasonText(reason: Reason): string {
  const kind = kindLabel(reason.kind);
  const scheme = reason.scheme ? SCHEMES[reason.scheme] : 'מספר';
  if (reason.source === 'registry') {
    return `במרשם, סוג התאגיד של ${scheme} ${reason.value ?? ''} הוא ${kind}.`;
  }
  if (reason.source === 'identifier') {
    return `${scheme} ${reason.value ?? ''}, שעדיין ממתין לבדיקה, מתאים ל${kind}.`;
  }
  return `שם הספק מרמז על ${kind}.`;
}

/** What happened after a decision, in Hebrew. */
export const DECISION_TEXT: Record<string, string> = {
  applied: 'הסוג נשמר.',
  approved: 'הסוג נשמר.',
  pending: 'השינוי נשלח לאישור של מנהל מערכת.',
  rejected: 'ההצעה נדחתה, והיא לא תוצע שוב.',
  outdated: 'הסוג של הספק כבר נקבע, ולכן ההצעה הוסרה.',
};
