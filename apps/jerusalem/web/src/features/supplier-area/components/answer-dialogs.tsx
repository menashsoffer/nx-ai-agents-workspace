// The offer and decline dialogs of an approach (supplier-approaches-spec-he.md 5.2, 5.3).
import { useActionState, useId, useState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { errorText } from '../../../data/errors.ts';
import { sendDecline, sendOffer, type Approach } from '../api/approaches.ts';
import { PROOF_MAX_BYTES, PROOF_TYPES } from '../api/portal.ts';
import { amountProblem, cleanAmount, DECLINE_REASONS, offerSummary } from '../model/approaches.ts';
import { proofProblem } from '../model/portal-model.ts';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** Runs the send, closes the dialog and reloads the area; returns an error sentence or ''. */
function useAnswer(dialogId: string) {
  const { revalidate } = useRevalidator();
  return async (send: () => Promise<void>): Promise<string> => {
    try {
      await send();
    } catch (failure) {
      return errorText(failure);
    }
    (document.getElementById(dialogId) as HTMLDialogElement | null)?.close();
    await revalidate();
    return '';
  };
}

function offerProblem(form: FormData, file: File | null): string | null {
  const vat = text(form, 'vat');
  return (
    amountProblem(text(form, 'amount')) ??
    (vat ? null : 'בחרו אם הסכום כולל מע״מ.') ??
    proofProblem(file, PROOF_TYPES, PROOF_MAX_BYTES)
  );
}

interface Value {
  value: string;
  set: (value: string) => void;
}

function VatField({ value, set }: Value) {
  return (
    <SelectField
      field={{ label: 'מע״מ' }}
      select={{
        name: 'vat',
        required: true,
        value,
        onChange: (event) => {
          set(event.currentTarget.value);
        },
        children: [
          <option key="" value="" disabled>
            בחרו
          </option>,
          <option key="yes" value="yes">
            כולל מע״מ
          </option>,
          <option key="no" value="no">
            לא כולל מע״מ
          </option>,
        ],
      }}
    />
  );
}

function OfferFile({ setFile }: { setFile: (f: File | null) => void }) {
  return (
    <FormField
      field={{ label: 'קובץ ההצעה', hint: 'PDF, JPEG או PNG, עד 10MB, חתום בידי הספק' }}
      input={{
        name: 'file',
        type: 'file',
        required: true,
        accept: PROOF_TYPES.join(','),
        onChange: (event) => {
          setFile(event.currentTarget.files?.[0] ?? null);
        },
      }}
    />
  );
}

interface Offer {
  amount: string;
  vat: string;
  note: string;
}

/** Controlled, so a refused send keeps what was typed (React resets a form after an action). */
interface FieldsProps {
  approach: Approach;
  offer: Offer;
  set: (next: Offer) => void;
  setFile: (f: File | null) => void;
}

function OfferFields({ approach, offer, set, setFile }: FieldsProps) {
  return (
    <>
      <FormField
        field={{ label: 'סכום ההצעה בש״ח' }}
        input={{
          name: 'amount',
          required: true,
          inputMode: 'decimal',
          dir: 'ltr',
          autoComplete: 'off',
          value: offer.amount,
          onChange: (event) => {
            set({ ...offer, amount: event.currentTarget.value });
          },
        }}
      />
      <VatField
        value={offer.vat}
        set={(vat) => {
          set({ ...offer, vat });
        }}
      />
      <OfferFile setFile={setFile} />
      <FormField
        field={{ label: 'הערה' }}
        input={{
          name: 'note',
          maxLength: 2000,
          value: offer.note,
          onChange: (event) => {
            set({ ...offer, note: event.currentTarget.value });
          },
        }}
      />
      {offer.vat && !amountProblem(offer.amount) && (
        <p>{offerSummary(offer.amount, offer.vat === 'yes', approach)}</p>
      )}
    </>
  );
}

export function OfferDialog({ supplierId, approach }: { supplierId: string; approach: Approach }) {
  const id = useId();
  const answer = useAnswer(id);
  const [file, setFile] = useState<File | null>(null);
  const [offer, setOffer] = useState<Offer>({ amount: '', vat: '', note: '' });
  const [error, action, pending] = useActionState(async (_: string, form: FormData) => {
    const problem = offerProblem(form, file);
    if (problem || !file) return problem ?? '';
    const offer = {
      supplierId,
      approachId: approach.id,
      amount: cleanAmount(text(form, 'amount')),
      includesVat: text(form, 'vat') === 'yes',
      file,
      note: text(form, 'note'),
    };
    return answer(() => sendOffer(offer));
  }, '');
  const title = `הגשת הצעה: ${approach.subject}`;
  return (
    <>
      <Button command={{ target: id, action: 'show-modal' }} data-usage="portal.offer">
        הגשת הצעה
      </Button>
      <Dialog id={id} title={title}>
        <form action={action} aria-label={title} noValidate>
          {error && <Notice tone="error" title={error} />}
          <OfferFields approach={approach} offer={offer} set={setOffer} setFile={setFile} />
          <FormActions>
            <Button type="submit" pending={pending} pendingLabel="שולח…">
              שליחת ההצעה
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}

function ReasonField({ value, set }: Value) {
  return (
    <SelectField
      field={{ label: 'למה' }}
      select={{
        name: 'reason',
        required: true,
        value,
        onChange: (event) => {
          set(event.currentTarget.value);
        },
        children: DECLINE_REASONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        )),
      }}
    />
  );
}

export function DeclineDialog({ approach }: { approach: Approach }) {
  const id = useId();
  const answer = useAnswer(id);
  const [reason, setReason] = useState('no_capacity');
  const [note, setNote] = useState('');
  const [error, action, pending] = useActionState(async () => {
    const why = note.trim();
    if (reason === 'other' && why.length < 2) return 'כתבו בכמה מילים למה.';
    return answer(() => sendDecline({ approachId: approach.id, reason, note: why }));
  }, '');
  const title = `לא מעוניינים: ${approach.subject}`;
  return (
    <>
      <Button variant="secondary" command={{ target: id, action: 'show-modal' }}>
        לא מעוניינים
      </Button>
      <Dialog id={id} title={title}>
        <form action={action} aria-label={title} noValidate>
          {error && <Notice tone="error" title={error} />}
          <ReasonField value={reason} set={setReason} />
          <FormField
            field={{ label: 'פירוט', hint: 'חובה כשבוחרים "אחר"' }}
            input={{
              name: 'note',
              maxLength: 2000,
              value: note,
              onChange: (event) => {
                setNote(event.currentTarget.value);
              },
            }}
          />
          <FormActions>
            <Button type="submit" pending={pending} pendingLabel="שולח…">
              שליחה
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}
