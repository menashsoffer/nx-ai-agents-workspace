/**
 * What went wrong, in the words of documentation/error-handling-spec-he.md section 3.
 * Every failure the site shows is one of these kinds; each kind has one cause sentence and
 * one "what to do now" sentence, and says whether pressing the button again can help.
 */
export type FailureKind =
  | 'offline'
  | 'timeout'
  | 'unavailable'
  | 'system'
  | 'session'
  | 'forbidden'
  | 'rule'
  | 'reason'
  | 'gone'
  | 'duplicate'
  | 'rate_limit'
  | 'unconfirmed';

export interface FailureText {
  /** Why it failed, one sentence. */
  cause: string;
  /** What to do now, one sentence. Empty when the cause already says it. */
  next: string;
  /** True only when trying the same thing again can succeed. */
  retry: boolean;
}

export const FAILURES: Record<FailureKind, FailureText> = {
  offline: {
    cause: 'אין חיבור לאינטרנט, והפעולה לא נשלחה.',
    next: 'מה שכתבתם נשאר. כשהחיבור יחזור, נסו שוב.',
    retry: true,
  },
  timeout: {
    cause: 'השרת לא ענה בזמן.',
    next: 'ייתכן שהחיבור איטי. בשמירה, בדקו ברשימה אם היא נקלטה לפני ניסיון נוסף.',
    retry: true,
  },
  unavailable: {
    cause: 'מסד הנתונים לא זמין כרגע.',
    next: 'התקלה אצלנו, לא אצלכם. נסו שוב בעוד כמה דקות. אם זה נמשך, פנו למנהל המערכת.',
    retry: true,
  },
  system: {
    cause: 'תקלה במערכת.',
    next: 'ניסיון חוזר כנראה לא יעזור. התקלה נרשמה ומנהל המערכת יראה אותה.',
    retry: false,
  },
  session: {
    cause: 'פג תוקף ההתחברות.',
    next: 'מה שכתבתם נשאר. התחברו שוב וחזרו לאותו מסך.',
    retry: false,
  },
  forbidden: {
    cause: 'אין לך הרשאה לפעולה הזו.',
    next: 'אם קיבלתם תפקיד עכשיו, רעננו את הדף.',
    retry: false,
  },
  rule: { cause: 'אחד הערכים לא תקין.', next: 'תקנו את השדה המסומן ונסו שוב.', retry: false },
  reason: { cause: 'הפעולה לא אושרה.', next: '', retry: false },
  gone: {
    cause: 'הפריט כבר לא קיים או כבר טופל.',
    next: 'ייתכן שמישהו אחר טיפל בו בינתיים. רעננו את הרשימה.',
    retry: false,
  },
  duplicate: {
    cause: 'הרשומה כבר קיימת.',
    next: 'בדקו את הרשומה הקיימת לפני ניסיון נוסף.',
    retry: false,
  },
  rate_limit: {
    cause: 'בוצעו יותר מדי פעולות בזמן קצר.',
    next: 'אפשר לנסות שוב בעוד שעה לכל היותר.',
    retry: false,
  },
  unconfirmed: {
    cause: 'לא ברור אם השינוי נשמר.',
    next: 'רעננו את הדף ובדקו לפני ניסיון נוסף, כדי לא לשמור פעמיים.',
    retry: false,
  },
};

/** PostgREST answers a dead or busy database with these codes (PGRST000-PGRST003). */
const DATABASE_DOWN = /^PGRST00[0-3]$/;

const BY_STATUS: Partial<Record<number, FailureKind>> = {
  401: 'session',
  403: 'forbidden',
  404: 'gone',
  409: 'duplicate',
  429: 'rate_limit',
  502: 'unavailable',
  503: 'unavailable',
  504: 'unavailable',
};

/** The kind of a failed HTTP answer, from its status and the error code in its body. */
export function kindOfStatus(status: number, code = ''): FailureKind {
  if (DATABASE_DOWN.test(code)) return 'unavailable';
  return BY_STATUS[status] ?? 'system';
}

/**
 * A request that never got an answer. Offline when the browser says so; a timeout when the
 * wait ran out; otherwise the server could not be reached although the network is up.
 */
export function kindOfNetworkError(error: unknown, online: boolean): FailureKind {
  if (!online) return 'offline';
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  return 'unavailable';
}

/** Cause and next step as one text, for places that show a single sentence. */
export function failureSentence(text: Pick<FailureText, 'cause' | 'next'>): string {
  return text.next ? `${text.cause} ${text.next}` : text.cause;
}
