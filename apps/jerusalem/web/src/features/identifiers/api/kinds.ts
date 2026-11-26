import { rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { DataError } from '../../../data/client.ts';
import { errorText } from '../../../data/errors.ts';
import { refreshScreen } from '../../../data/screen-data.ts';
import { DECISION_TEXT } from '../model/kinds.ts';
import { CANDIDATES_KEY } from './candidates.ts';

export const INITIAL_KIND = { error: '', message: '', committed: false };

async function refreshed(message: string) {
  try {
    await refreshScreen(CANDIDATES_KEY);
    return message;
  } catch {
    return `${message} יש לרענן את הרשימה לפני פעולה נוספת.`;
  }
}

/** Accept or reject one suggestion; accepting sends a checked kind change (spec 3). */
export async function decideKind(id: string, form: FormData) {
  const decision = form.get('decision');
  if (decision !== 'accept' && decision !== 'reject') {
    return { ...INITIAL_KIND, error: 'יש לבחור החלטה.' };
  }
  let message: string;
  try {
    const status = await rpc(
      'decide_kind_suggestion',
      { target: id, accept: decision === 'accept' },
      z.string(),
    );
    message = DECISION_TEXT[status] ?? 'ההחלטה נשמרה.';
  } catch (error) {
    if (!(error instanceof DataError && error.status === 404)) {
      return { ...INITIAL_KIND, error: errorText(error) };
    }
    message = 'ההצעה כבר טופלה.';
  }
  return { error: '', message: await refreshed(message), committed: true };
}

/** Admin only: suggests a kind for every supplier whose kind is still unknown. */
export async function suggestKinds() {
  try {
    const result = await rpc(
      'suggest_supplier_kinds',
      {},
      z.object({ created: z.number(), unknown: z.number() }),
    );
    const created = String(result.created);
    const unknown = String(result.unknown);
    return {
      ...INITIAL_KIND,
      message: await refreshed(`נוספו ${created} הצעות. ${unknown} ספקים עדיין בסוג לא ידוע.`),
    };
  } catch (error) {
    return { ...INITIAL_KIND, error: errorText(error) };
  }
}
