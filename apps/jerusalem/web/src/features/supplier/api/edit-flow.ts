import { supplierKey } from '../../../data/react-catalog.ts';
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import type { SupplierChange } from '../../../data/supplier-changes.ts';
import type { FieldErrors } from '../../../lib/rules/forms.ts';
import { formText } from '../model/add-form.ts';
import { overall, reasonNeeded, sameChanges, type CheckedChange } from '../model/change-checks.ts';
import { parseEditForm, REASON } from '../model/edit-form.ts';
import { checkChanges, submitChanges } from './changes.ts';
import { refreshRegistry } from './registry-check.ts';
import { IDLE, saveAndRefresh, type SaveResult } from './write.ts';

export interface EditState extends SaveResult {
  errors: FieldErrors;
  /** What was typed, so a refused form shows it again instead of the saved values. */
  typed: Record<string, string>;
  /** The checks of the changes as they were when last checked; null before any check. */
  checked: CheckedChange[] | null;
  /** True once the save went through, so the form starts again from the saved values. */
  done: boolean;
}
export const START: EditState = { ...IDLE, errors: {}, typed: {}, checked: null, done: false };

function typedValues(form: FormData): Record<string, string> {
  const typed: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === 'string') typed[key] = value;
  });
  return typed;
}

const REASON_ERROR = 'צריך לכתוב סיבה לשינוי, לפחות 3 תווים.';
const RED_ERROR = 'יש שינוי שלא עבר את הבדיקה ולא יישמר. תקנו את מה שמסומן באדום ושמרו שוב.';

async function save(
  changes: SupplierChange[],
  reason: string,
  data: SupplierDetail,
): Promise<SaveResult> {
  return saveAndRefresh(
    () => submitChanges(changes, reason),
    supplierKey(data.supplier.id),
    (answer) => answer,
  );
}

export interface EditContext {
  data: SupplierDetail;
  admin: boolean;
}

/** The checks for these changes: the last ones when nothing changed since, else new ones. */
async function checksFor(previous: EditState, changes: SupplierChange[]) {
  const known = previous.checked;
  const same = known?.map((item) => item.change) ?? [];
  if (known && sameChanges(same, changes)) return { checked: known, fresh: true };
  // A name or kind is compared with the registry, so its answer is brought up to date first.
  const registry = changes.find((c) => c.kind === 'rename' || c.kind === 'entity_kind');
  if (registry) await refreshRegistry(registry.supplier_id);
  return { checked: await checkChanges(changes), fresh: false };
}

/** After the checks: refuse red, ask for a reason where needed, else save. */
async function afterChecks(
  state: EditState & { checked: CheckedChange[] },
  form: FormData,
  { context, fresh }: { context: EditContext; fresh: boolean },
): Promise<EditState> {
  if (overall(state.checked) === 'red') return { ...state, error: RED_ERROR };
  const reason = formText(form, REASON);
  const needsReason = reasonNeeded(state.checked, context.admin);
  if (needsReason && !fresh) return { ...state, message: 'בדקו את התוצאות, כתבו סיבה ושמרו.' };
  if (needsReason && reason.length < 3) return { ...state, errors: { [REASON]: REASON_ERROR } };
  const changes = state.checked.map((item) => item.change);
  const result = await save(changes, reason, context.data);
  if (result.error) return { ...state, ...result };
  return { ...START, ...result, done: true };
}

/**
 * The dialog's one button (spec section 6.6). The first press checks every change in the
 * database. All green and no reason needed: saved at once. Otherwise the results show and the
 * next press, with a reason where one is needed, saves or sends for a decision. Editing a
 * field after the check checks again.
 */
export async function runEdit(
  previous: EditState,
  form: FormData,
  context: EditContext,
): Promise<EditState> {
  const typed = typedValues(form);
  const parsed = parseEditForm(form, context.data);
  if ('errors' in parsed) {
    return { ...START, error: 'יש לתקן את השדות המסומנים.', errors: parsed.errors, typed };
  }
  if ('unchanged' in parsed) return { ...START, message: 'אין שינויים לשמירה.' };
  try {
    const { checked, fresh } = await checksFor(previous, parsed.changes);
    return await afterChecks({ ...START, typed, checked }, form, { context, fresh });
  } catch (error) {
    return { ...START, error: error instanceof Error ? error.message : 'הבדיקה נכשלה.', typed };
  }
}
