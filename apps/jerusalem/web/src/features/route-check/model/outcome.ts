// What the request form says after a failed attempt (error-handling-spec-he.md 3 and 5).
import { errorText } from '../../../data/errors.ts';

/** What the form says after a failed attempt (error-handling-spec-he.md sections 3 and 5). */
export interface Outcome {
  tone: 'error' | 'warning';
  title: string;
  text: string;
}
export const NONE: Outcome | null = null;

/** The request is saved, so the check runs on it again and never saves a second copy. */
export function savedButUnchecked(error: unknown): Outcome {
  return {
    tone: 'warning',
    title: 'הבקשה נשמרה, אבל הבדיקה נכשלה.',
    text: `${errorText(error)} הבקשה מחכה גם ב"בקשות שמורות", ואפשר לבדוק אותה שוב בלי לשמור מחדש.`,
  };
}

export function notUpdated(error: unknown): Outcome {
  return { tone: 'error', title: 'השינויים לא נשמרו.', text: errorText(error) };
}

export function failed(error: unknown): Outcome {
  return { tone: 'error', title: 'לא ניתן לבדוק את הבקשה.', text: errorText(error) };
}
