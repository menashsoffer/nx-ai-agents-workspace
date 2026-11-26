import { z } from '../../../data/zod.ts';
export const candidateSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  scheme: z.enum(['company', 'nonprofit', 'vat_dealer', 'personal_id']),
  value: z.string().regex(/^[0-9]{5,9}$/),
  source: z.enum(['companies_registrar', 'nonprofits_registrar', 'guidestar', 'pool_file']),
  registrar_name: z.string().nullable(),
  registrar_status: z.string().nullable(),
  searched_name: z.string(),
  found_at: z.string(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const SOURCES = {
  companies_registrar: 'רשם החברות',
  nonprofits_registrar: 'רשם העמותות',
  guidestar: 'GuideStar — רשם העמותות',
  pool_file: 'קובץ מאגר מאוחד (לא נבדק מול רשם)',
};
export const SCHEMES = {
  company: 'מספר חברה',
  nonprofit: 'מספר עמותה',
  vat_dealer: 'מספר עוסק מורשה',
  personal_id: 'מספר זהות או עוסק',
};
export function evidenceHint(candidate: Candidate, supplier: string): string {
  return candidate.source === 'pool_file'
    ? 'המספר נלקח מקובץ ושויך לספק לפי השם בלבד. יש לבדוק אותו במרשם לפני אישור.'
    : nameHint(supplier, candidate.registrar_name);
}
export function nameHint(supplier: string, registered: string | null): string {
  const normalize = (name: string) =>
    name
      .normalize('NFKC')
      .toLocaleLowerCase('he')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return registered && normalize(registered) === normalize(supplier)
    ? 'השמות זהים לאחר נרמול טקסט. זהו רמז בלבד, ולא הוכחה לזהות הספק.'
    : 'יש להשוות את השמות והאסמכתאות ידנית. דמיון בשם אינו הוכחה לזהות הספק.';
}
