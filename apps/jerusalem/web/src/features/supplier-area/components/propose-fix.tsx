import { useActionState, useId, useState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { IconButton } from '../../../ui/icon-button.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { errorText } from '../../../data/errors.ts';
import { proposeChange } from '../api/portal.ts';
import { CONTACT_LABELS, proposalProblem } from '../model/portal-model.ts';

/** The detail a fix is for: the name, one contact, or a new contact (no contact id). */
export interface FixTarget {
  kind: 'rename' | 'contact';
  label: string;
  current?: string;
  contactKind?: string;
  contactId?: string;
}

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

/** The error, and what was typed: the form resets after each send, so a fix keeps its text. */
interface SendState {
  error: string;
  value: string;
  reason: string;
  contactKind: string;
}
const EMPTY: SendState = { error: '', value: '', reason: '', contactKind: '' };

function useSend(supplierId: string, target: FixTarget, close: () => void) {
  const { revalidate } = useRevalidator();
  return useActionState(async (_previous: SendState, form: FormData): Promise<SendState> => {
    const fields = {
      kind: target.kind,
      contact_kind: target.contactKind ?? text(form, 'contact_kind'),
      value: text(form, 'value').trim(),
      reason: text(form, 'reason').trim(),
    };
    const typed = { value: fields.value, reason: fields.reason, contactKind: fields.contact_kind };
    const problem = proposalProblem(fields);
    if (problem) return { error: problem, ...typed };
    try {
      await proposeChange({
        supplier_id: supplierId,
        kind: fields.kind,
        value: fields.value,
        ...(fields.kind === 'contact' ? { contact_kind: fields.contact_kind } : {}),
        ...(target.contactId ? { contact_id: target.contactId } : {}),
        ...(fields.reason ? { reason: fields.reason } : {}),
      });
    } catch (failure) {
      return { error: errorText(failure), ...typed };
    }
    close();
    await revalidate();
    return EMPTY;
  }, EMPTY);
}

function Fields({ target, typed }: { target: FixTarget; typed: SendState }) {
  return (
    <>
      {target.current && (
        <p>
          עכשיו: <bdi>{target.current}</bdi>
        </p>
      )}
      {target.kind === 'contact' && !target.contactKind && (
        <SelectField
          field={{ label: 'סוג הפרט' }}
          select={{
            name: 'contact_kind',
            required: true,
            defaultValue: typed.contactKind,
            children: Object.entries(CONTACT_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            )),
          }}
        />
      )}
      <FormField
        field={{ label: target.current ? 'הערך הנכון' : 'הערך' }}
        input={{
          name: 'value',
          required: true,
          maxLength: 500,
          autoComplete: 'off',
          defaultValue: typed.value,
        }}
      />
      <FormField
        field={{
          label: 'סיבה',
          hint: target.kind === 'rename' ? 'חובה בשינוי שם' : 'לא חובה',
        }}
        input={{
          name: 'reason',
          required: target.kind === 'rename',
          maxLength: 500,
          defaultValue: typed.reason,
        }}
      />
    </>
  );
}

/** "הצעת תיקון" (spec 6.4): one dialog per detail; the result is a neutral sentence. */
export function ProposeFix({ supplierId, target }: { supplierId: string; target: FixTarget }) {
  const id = useId();
  const [sent, setSent] = useState(false);
  const close = () => {
    (document.getElementById(id) as HTMLDialogElement | null)?.close();
    setSent(true);
  };
  const [state, action, pending] = useSend(supplierId, target, close);
  const title = target.contactId || target.kind === 'rename' ? `תיקון ${target.label}` : 'פרט חדש';
  return (
    <>
      {target.contactId || target.kind === 'rename' ? (
        <IconButton
          icon="pencil"
          label={`הצעת תיקון: ${target.label}`}
          tip="הצעת תיקון"
          command={{ target: id, action: 'show-modal' }}
        />
      ) : (
        <Button type="button" variant="secondary" command={{ target: id, action: 'show-modal' }}>
          הוספת פרט קשר
        </Button>
      )}
      {sent && <span role="status">נבדוק את השינוי ונעדכן.</span>}
      <Dialog id={id} title={title}>
        <form action={action} aria-label={title} noValidate>
          {state.error && <Notice tone="error" title={state.error} />}
          <Fields target={target} typed={state} />
          <FormActions>
            <Button
              type="submit"
              pending={pending}
              pendingLabel="שולח…"
              data-usage="portal.propose"
            >
              שליחה לבדיקה
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}
