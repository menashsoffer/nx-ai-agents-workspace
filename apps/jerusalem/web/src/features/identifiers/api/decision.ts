import { errorText } from '../../../data/errors.ts';
import { DataError } from '../../../data/client.ts';
import { CANDIDATES_KEY, decideCandidate } from './candidates.ts';
import { refreshScreen } from '../../../data/screen-data.ts';
export const INITIAL_DECISION = { error: '', message: '', committed: false };
export async function decide(id: string, form: FormData) {
  const decision = form.get('decision');
  if (decision !== 'accept' && decision !== 'dismiss')
    return { ...INITIAL_DECISION, error: 'יש לבחור החלטה.' };
  let message =
    decision === 'accept' ? 'המועמד הועבר לבדיקה נוספת. המזהה עדיין אינו מאומת.' : 'המועמד נדחה.';
  try {
    await decideCandidate(id, decision === 'accept');
  } catch (error) {
    if (!(error instanceof DataError && error.status === 404))
      return {
        ...INITIAL_DECISION,
        error: errorText(error),
      };
    message = 'המועמד כבר טופל.';
  }
  try {
    await refreshScreen(CANDIDATES_KEY);
  } catch {
    message += ' יש לרענן את הרשימה לפני פעולה נוספת.';
  }
  return { error: '', message, committed: true };
}
