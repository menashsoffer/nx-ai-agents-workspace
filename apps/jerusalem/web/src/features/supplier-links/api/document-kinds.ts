// The supplier document kinds, as the supplier area names them (supplier-area/model/kinds.ts).
// Kept here too: a module shared by both lazy screens becomes its own chunk, and its name in
// the preload map pushes the first load over its budget.
export const DOCUMENT_KINDS = [
  'bookkeeping',
  'tax_withholding',
  'insurance',
  'proper_management',
] as const;

export const DOCUMENT_LABELS: Record<(typeof DOCUMENT_KINDS)[number], string> = {
  bookkeeping: 'אישור ניהול ספרים',
  tax_withholding: 'אישור ניכוי מס במקור',
  insurance: 'אישור קיום ביטוחים',
  proper_management: 'אישור ניהול תקין',
};
