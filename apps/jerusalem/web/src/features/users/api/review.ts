import { errorText } from '../../../data/errors.ts';
import { reviewProfile, USERS_KEY } from './users.ts';
import { refreshScreen } from '../../../data/screen-data.ts';
import { noteError } from '../model/permissions.ts';
export const INITIAL_REVIEW = { error: '', fieldError: '', committed: false };
export async function decideReview(id: string, form: FormData) {
  const decision = form.get('decision'),
    value = form.get('note');
  const note = typeof value === 'string' ? value.trim() : '';
  if (decision !== 'active' && decision !== 'rejected')
    return { ...INITIAL_REVIEW, error: 'יש לבחור החלטה.' };
  const invalid = noteError(decision, note);
  if (invalid) return { ...INITIAL_REVIEW, fieldError: invalid };
  try {
    await reviewProfile(id, decision, note);
  } catch (error) {
    return {
      ...INITIAL_REVIEW,
      error: errorText(error),
    };
  }
  try {
    await refreshScreen(USERS_KEY);
    return { ...INITIAL_REVIEW, committed: true };
  } catch {
    return {
      ...INITIAL_REVIEW,
      committed: true,
      error: 'ההחלטה נשמרה. יש לרענן כדי לראות את הרשימה העדכנית.',
    };
  }
}
