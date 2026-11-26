// Text for a row the database refused (excel-import-errors-spec-he.md, section 5). Kept in the
// import feature so the main bundle carries only the shared reason texts.
import { reasonMessage, registerReasons } from '../../../lib/errors/reasons.ts';

/** Refusals only the import sends (excel-import-errors-spec-he.md, section 5). */
export const IMPORT_REASONS = {
  import_batch_invalid: 'סוג, גודל, מספר שורות או שם הקובץ לא תקינים. בדקו את הקובץ ונסו שוב.',
  import_batch_missing: 'הטיוטה לא נמצאה, אולי כבר נקלטה. רעננו את הדף ופתחו אותה מחדש.',
  import_file_missing: 'הקובץ המקורי לא נשמר באחסון או גדול מ-5 MB. בחרו את הקובץ שוב.',
  import_registry_invalid: 'המאגר או הגרסה שנבחרו לא נמצאו. רעננו את הדף ובחרו מאגר שוב.',
  import_row_invalid: 'בקובץ יש ערך שנראה כמו נוסחה, קוד או תו נסתר. תקנו את הקובץ ונסו שוב.',
  import_decision_invalid: 'החלטה לא תקינה: ערך לא בטוח, ספק לא פעיל או דילוג בלי סיבה.',
  import_unsafe_value: 'בשורה יש ערך שנראה כמו נוסחה או קוד, ולכן היא לא נקלטה. תקנו אותו בטיוטה.',
  import_name_invalid: 'לשורה אין שם ספק, או שהשם ארוך מ-300 תווים. תקנו את השם בטיוטה.',
  import_fields_invalid: 'סוג ספק, אתר, מספר מזהה או פרט קשר לא תקין. תקנו אותו בטיוטה.',
} as const;

registerReasons(IMPORT_REASONS);

/** A row the database could not import for an unexpected reason, with its SQL state. */
export function importRowError(error: string): string {
  const known = reasonMessage(error);
  if (known) return known;
  const state = /^reason:import_row_failed:([0-9A-Z]{5})$/.exec(error)?.[1];
  const code = state ? ` (קוד ${state})` : '';
  return `השורה לא נקלטה בגלל תקלה במסד${code}. היא נשארה ממתינה. אפשר לנסות שוב, ואם זה חוזר לפנות למנהל המערכת.`;
}
