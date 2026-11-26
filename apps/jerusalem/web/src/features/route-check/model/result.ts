import { z } from '../../../data/zod.ts';
export const resultSchema = z
  .object({
    id: z.number().int().nullable(),
    route: z.string(),
    regulation: z.string().min(1),
    approver: z.string(),
    status: z.enum(['ok', 'needs_review', 'blocked']),
    allowed: z.boolean(),
    requirements: z.array(z.string()),
    missing: z.array(z.string()),
    warnings: z.array(z.string()),
    comparedValue: z.number().nonnegative().nullable(),
    increasePercent: z.number().nullable(),
    thresholdsSource: z.string().nullable(),
    splittingChecked: z.boolean().nullable(),
  })
  .refine((result) => result.allowed === (result.status === 'ok'));
export type CheckResult = z.infer<typeof resultSchema>;
export const STATUS_LABELS = {
  ok: 'התנאים שנבדקו מתקיימים',
  needs_review: 'נדרשת בדיקה נוספת',
  blocked: 'המסלול חסום',
};
const ROUTES: Record<string, string> = {
  no_tender_low_value: 'ללא מכרז בשל שווי ההתקשרות',
  zuta_4: 'מכרז זוטא — ארבע הצעות',
  zuta_6: 'מכרז זוטא — שש הצעות',
  public_tender: 'מכרז פומבי',
};
export function routeLabel(route: string): string {
  return (
    ROUTES[route] ??
    (route.startsWith('exemption_') ? 'פטור לפי התקנה המצוינת' : 'מסלול הדורש בדיקה')
  );
}
/** A draft is checked without being saved; the database validates every field again. */
export const draftSchema = z.object({
  estimated_value: z.number().nonnegative().max(999999999999),
  value_includes_vat: z.boolean(),
  requested_exemption: z
    .string()
    .regex(/^3\([0-9]+א?\)$/)
    .nullable(),
});
export type Draft = z.infer<typeof draftSchema>;
export const checkInputSchema = z.union([
  z.object({
    request_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    on: z.iso.date(),
  }),
  z.object({ draft: draftSchema, on: z.iso.date() }),
]);
export type CheckInput = z.infer<typeof checkInputSchema>;
export function money(value: number): string {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(value);
}
