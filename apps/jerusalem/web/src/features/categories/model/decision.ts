import { z } from '../../../data/zod.ts';
import { check, decisionNote } from '../../../lib/rules/forms.ts';
export const requestSchema = z.object({
  id: z.string(),
  proposed_name: z.string(),
  description: z.string(),
  parent_id: z.string().nullable(),
  source_reference: z.string().nullable(),
  created_by: z.string().nullable(),
});
export type CategoryRequest = z.infer<typeof requestSchema>;
export type DecisionField = 'decision' | 'note' | 'category_id';
type Decision =
  | { field: DecisionField; error: string }
  | { decision: 'approved' | 'rejected' | 'linked'; note: string; category_id: string | null };
const decisionSchema = z.enum(['approved', 'rejected', 'linked']);
function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
export function parseDecision(form: FormData): Decision {
  const parsed = decisionSchema.safeParse(form.get('decision'));
  if (!parsed.success) return { field: 'decision', error: 'יש לבחור החלטה.' };
  const decision = parsed.data,
    note = formText(form, 'note'),
    category = formText(form, 'category_id');
  // The table requires a note for every decision on a category request.
  const checked = check(decisionNote(decision, true), { note });
  if (!checked.ok) return { field: 'note', error: checked.errors.note ?? '' };
  if (decision === 'linked' && !category)
    return { field: 'category_id', error: 'יש לבחור קטגוריה קיימת לקישור.' };
  return { decision, note, category_id: decision === 'linked' ? category : null };
}
