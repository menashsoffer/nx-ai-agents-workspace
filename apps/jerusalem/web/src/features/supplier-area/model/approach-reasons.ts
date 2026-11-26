// Refusals a supplier can meet when answering an approach (supplier-approaches-spec-he.md 7.4).
// Kept in this screen, so the first load carries no approach texts.
import { registerReasons } from '../../../lib/errors/reasons.ts';

export const SUPPLIER_APPROACH_REASONS = {
  approach_closed: 'המועד לתשובה עבר, או שהיחידה ביטלה את הבקשה. אי אפשר לענות עכשיו.',
  approach_answered: 'כבר עניתם על הפנייה. כדי לשנות, בטלו קודם את התשובה הקודמת.',
  approach_amount: 'כתבו סכום חיובי עם עד שתי ספרות אחרי הנקודה, ובחרו אם הוא כולל מע״מ.',
} as const;

registerReasons(SUPPLIER_APPROACH_REASONS);
