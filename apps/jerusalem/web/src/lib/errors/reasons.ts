/**
 * Refusals the database and the Edge Functions send as `reason:<key>`
 * (error-handling-spec-he.md section 6). Each text says why and what to do now.
 * tests/reasons-contract-test.ts checks that every key raised on the server is here and
 * that every key here is raised somewhere.
 */
export const REASON_MESSAGES = {
  last_admin: 'אי אפשר להסיר את מנהל המערכת האחרון. קודם הוסיפו מנהל מערכת נוסף.',
  role_already_removed: 'התפקיד כבר הוסר. רעננו את הרשימה.',
  no_active_profile: 'למשתמש אין חשבון פעיל. קודם אשרו את בקשת ההצטרפות שלו.',
  identifier_taken: 'המספר הזה כבר רשום אצל ספק אחר. פתחו את הספק ההוא ובדקו אם זה אותו ספק.',
  supplier_inactive: 'הספק מסומן כלא פעיל. סמנו אותו כפעיל לפני השינוי.',
  supplier_unavailable: 'הספק לא נמצא או אוחד עם ספק אחר. חפשו אותו מחדש באיתור ספקים.',
  already_decided: 'כבר הוחלט על הפריט הזה, אולי על ידי מישהו אחר. רעננו את הרשימה.',
  reason_required: 'צריך לכתוב סיבה לדחייה.',
  threshold_start_day: 'סף חדש מתחיל ב-16 בחודש. בחרו תאריך התחלה ב-16.',
  choose_active_category: 'הקטגוריה שנבחרה לא פעילה. בחרו קטגוריה פעילה.',
  self_verification: 'אי אפשר לאמת שורה שאתם הזנתם. מנהל יחידה אחר או מנהל מערכת צריך לאמת אותה.',
  no_thresholds:
    'אין סף מכרז מאושר לתאריך הזה. בחרו תאריך אחר, או בקשו ממנהל מערכת לאשר את הסף החודשי.',
  change_blocked: 'השינוי לא עבר את הבדיקה ולא נשמר. תקנו את מה שמסומן באדום ונסו שוב.',
  change_reason_required: 'צריך לכתוב סיבה לשינוי, לפחות 3 תווים.',
  proposal_blocked: 'את השינוי הזה אי אפשר לשלוח כך. בדקו את הערך, או פנו ליחידה שאיתה אתם עובדים.',
  proposal_pending: 'כבר שלחתם תיקון לפרט הזה והוא מחכה לבדיקה. אפשר לבטל אותו ולשלוח חדש.',
  change_outdated: 'פרטי הספק השתנו מאז שהבקשה נשלחה. רעננו את הדף ובדקו את הבקשה מחדש.',
  self_approval: 'אי אפשר לאשר בקשה ששלחתם בעצמכם. עורך אחר או מנהל מערכת צריך להחליט עליה.',
  bad_choice: 'לא נבחרה החלטה. בחרו אישור או דחייה.',
  // The supplier personal area (supplier-portal-spec-he.md, section 5).
  sign_in_required: 'צריך להיכנס עם Google או עם קישור בדוא"ל כדי להמשיך.',
  identifier_invalid: 'המספר לא תקין. הקלידו את כל 9 הספרות של ח"פ או של מספר העמותה.',
  too_many_attempts: 'היו יותר מדי ניסיונות בשעה האחרונה. נסו שוב בעוד שעה.',
  person_required: 'קודם מלאו את השם שלכם, ואז שייכו את עצמכם לספק.',
  already_linked: 'כבר יש לכם שיוך לספק הזה, פעיל או ממתין. פתחו את התיק שלכם.',
  proof_required:
    'הדוא"ל שאיתו נכנסתם לא רשום אצלנו לספק הזה. צרפו תדפיס רשם או ייפוי כוח, או היכנסו עם הדוא"ל הרשום.',
  invite_unavailable: 'ההזמנה כבר התקבלה, פגה, או נשלחה לדוא"ל אחר. בקשו מהעירייה הזמנה חדשה.',
  file_required: 'הקובץ לא הגיע. צרפו אותו שוב.',
  date_invalid: 'בחרו תאריך תוקף מהיום ועד עשר שנים.',
  invite_email_unknown: 'אפשר להזמין רק דוא"ל שכבר רשום לספק. הוסיפו אותו קודם לפרטי הספק.',
} as const;

export type ReasonKey = keyof typeof REASON_MESSAGES;

const featureReasons = new Map<string, string>();

/** Adds the texts of a lazy-loaded screen, so the main bundle carries only the shared ones. */
export function registerReasons(texts: Readonly<Record<string, string>>): void {
  for (const [key, text] of Object.entries(texts)) featureReasons.set(key, text);
}

/** The Hebrew text for a server message `reason:<key>`, or null for any other message. */
export function reasonMessage(message: string): string | null {
  const key = /^reason:([a-z_]+)$/.exec(message.trim())?.[1] ?? '';
  if (Object.hasOwn(REASON_MESSAGES, key)) return REASON_MESSAGES[key as ReasonKey];
  return featureReasons.get(key) ?? null;
}
