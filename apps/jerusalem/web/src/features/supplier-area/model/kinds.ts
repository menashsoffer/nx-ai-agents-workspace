// The document kinds a supplier is asked for (supplier-portal-spec-he.md 6.5, decision 5).
export const DOCUMENT_KINDS = [
  'bookkeeping',
  'tax_withholding',
  'insurance',
  'proper_management',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  bookkeeping: 'אישור ניהול ספרים',
  tax_withholding: 'אישור ניכוי מס במקור',
  insurance: 'אישור קיום ביטוחים',
  proper_management: 'אישור ניהול תקין',
};
