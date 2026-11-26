/**
 * One key per broken rule. The zod schemas in this folder and the SQL checks in
 * `private.rule_problem` report the same keys; the database sends them as `invalid:<key>`.
 * documentation/validation-rules-he.md lists every rule in plain language.
 */
export const RULE_MESSAGES = {
  required: 'שדה חובה.',
  too_short: 'הערך קצר מדי.',
  too_long: 'הערך ארוך מדי.',
  needs_letters: 'יש לכתוב מילים, לא רק מספרים או סימנים.',
  repeated: 'הערך נראה כמו הקלדה שגויה (אותו תו חוזר שוב ושוב).',
  control_chars: 'הערך מכיל תווים לא חוקיים.',
  bad_phone: 'מספר טלפון לא תקין. יש לכתוב מספר כמו 0501234567 או 026297777.',
  bad_email: 'כתובת דוא״ל לא תקינה. למשל name@example.co.il.',
  bad_website: 'כתובת אתר לא תקינה. למשל www.example.co.il.',
  has_at: 'נראה שזו כתובת דוא״ל. יש לבחור בסוג "דוא״ל".',
  bad_identifier: 'מספר מזהה לא תקין לסוג שנבחר.',
  bad_check_digit: 'ספרת הביקורת של המספר המזהה שגויה. יש לבדוק את המספר.',
  identifier_pair: 'יש למלא גם סוג מזהה וגם מספר, או להשאיר את שניהם ריקים.',
  bad_date: 'תאריך לא תקין.',
  date_future: 'התאריך עוד לא הגיע.',
  date_range: 'התאריך מחוץ לטווח הסביר.',
  dates_order: 'תאריך הסיום מוקדם מתאריך ההתחלה.',
  bad_choice: 'יש לבחור אחת מהאפשרויות.',
  bad_amount: 'יש לכתוב סכום בש״ח, גדול מאפס, עם עד שתי ספרות אחרי הנקודה.',
  bad_exemption: 'פטור נכתב כמו 3(8) או 3(29א).',
  request_closed: 'הבקשה כבר נסגרה: אושרה, נדחתה, בוטלה או שנבחר לה זוכה. יש לרענן את הדף.',
} as const;

export type RuleKey = keyof typeof RULE_MESSAGES;

export function isRuleKey(value: string): value is RuleKey {
  return Object.hasOwn(RULE_MESSAGES, value);
}

/** The Hebrew message for a database error `invalid:<key>`, or null for any other error. */
export function databaseRuleMessage(error: string): string | null {
  const key = /^invalid:([a-z_]+)$/.exec(error.trim())?.[1] ?? '';
  return isRuleKey(key) ? RULE_MESSAGES[key] : null;
}
