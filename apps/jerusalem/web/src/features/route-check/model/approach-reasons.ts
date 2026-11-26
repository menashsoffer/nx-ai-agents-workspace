// Refusals staff can meet when recording approaches and their answers
// (supplier-approaches-spec-he.md 7.4).
// Kept in this screen, so the first load carries no approach texts.
import { registerReasons } from '../../../lib/errors/reasons.ts';

export const STAFF_APPROACH_REASONS = {
  approach_closed: 'הבקשה בוטלה, או שהמועד לתשובה כבר עבר. אי אפשר לשנות את הפניות שלה.',
  approach_deadline: 'בחרו מועד מחר ועד 90 יום, ולא מוקדם מהמועד הקיים.',
  approach_answered: 'לפנייה הזו כבר יש תשובה.',
  approach_amount: 'כתבו סכום חיובי עם עד שתי ספרות אחרי הנקודה, ובחרו אם הוא כולל מע״מ.',
  approach_award_offer: 'אפשר לבחור רק ספק שהגיש הצעה, ורק אחרי שהמועד להגשה עבר.',
  approach_award_note: 'הנימוק ארוך מדי. כתבו עד 2,000 תווים.',
} as const;

registerReasons(STAFF_APPROACH_REASONS);
