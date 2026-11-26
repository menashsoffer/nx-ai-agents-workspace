import { useActionState, useState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { REASON_MESSAGES } from '../../../lib/errors/reasons.ts';
import {
  findSupplier,
  PROOF_MAX_BYTES,
  PROOF_TYPES,
  requestLink,
  uploadProof,
} from '../api/portal.ts';
import { proofProblem, readIdentifier } from '../model/portal-model.ts';
import styles from './area.module.css';
import { reportStep } from '../../../lib/usage-signal.ts';

interface Found {
  supplier_id: string;
  name: string;
}
type Step =
  { kind: 'number' } | { kind: 'confirm'; found: Found } | { kind: 'proof'; found: Found };
const STEP_ORDER: readonly Step['kind'][] = ['number', 'confirm', 'proof'];
interface Result {
  error: string;
  next?: Step;
}

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

async function lookUp(form: FormData): Promise<Result> {
  const read = readIdentifier(text(form, 'identifier'));
  if ('error' in read) return { error: read.error };
  const found = await findSupplier(read.scheme, read.value);
  if (!found)
    return {
      error: 'הספק לא נמצא במאגרי העירייה. להצטרפות למאגר פנו ליחידה שמפרסמת אותו באתר העירייה.',
    };
  return { error: '', next: { kind: 'confirm', found } };
}

/** Links at once on an email match; otherwise the proof step follows. */
async function confirm(found: Found): Promise<Result> {
  try {
    await requestLink(found.supplier_id, null);
    return { error: '' };
  } catch (failure) {
    const message = errorText(failure);
    if (message === REASON_MESSAGES.proof_required)
      return { error: '', next: { kind: 'proof', found } };
    return { error: message };
  }
}

/** The file comes from the input's change event, not FormData, so a re-render keeps it. */
async function sendProof(found: Found, proof: File | null): Promise<Result> {
  const problem = proofProblem(proof, PROOF_TYPES, PROOF_MAX_BYTES);
  if (problem || !proof) return { error: problem ?? '' };
  await requestLink(found.supplier_id, await uploadProof(proof));
  return { error: '' };
}

function useStep(step: Step, setStep: (next: Step) => void, proof: File | null) {
  const { revalidate } = useRevalidator();
  return useActionState(async (_previous: string, form: FormData) => {
    try {
      const result =
        step.kind === 'number'
          ? await lookUp(form)
          : step.kind === 'confirm'
            ? await confirm(step.found)
            : await sendProof(step.found, proof);
      if (result.next) {
        setStep(result.next);
        reportStep(STEP_ORDER.indexOf(result.next.kind) + 1);
      } else if (!result.error) await revalidate();
      return result.error;
    } catch (failure) {
      return errorText(failure);
    }
  }, '');
}

interface FieldsProps {
  step: Step;
  onProof: (file: File | null) => void;
  /** The number stays as typed when the form resets after a failed lookup. */
  number: [string, (value: string) => void];
}

function StepFields({ step, onProof, number }: FieldsProps) {
  return (
    <>
      {step.kind === 'number' && (
        <FormField
          field={{ label: 'ח"פ או מספר עמותה', hint: '9 ספרות, כפי שמופיעות בתעודת הרישום' }}
          input={{
            name: 'identifier',
            required: true,
            inputMode: 'numeric',
            maxLength: 11,
            pattern: '[0-9\\- ]{9,11}',
            autoComplete: 'off',
            value: number[0],
            onChange: (event) => {
              number[1](event.currentTarget.value);
            },
          }}
        />
      )}
      {step.kind !== 'number' && (
        <p>
          האם זה הספק שלכם? <strong>{step.found.name}</strong>
        </p>
      )}
      {step.kind === 'proof' && (
        <>
          <Notice tone="info" title={REASON_MESSAGES.proof_required}>
            העירייה תבדוק את הקובץ ותאשר את השיוך.
          </Notice>
          <FormField
            field={{ label: 'תדפיס רשם או ייפוי כוח', hint: 'PDF, JPEG או PNG, עד 10MB' }}
            input={{
              name: 'proof',
              type: 'file',
              required: true,
              accept: PROOF_TYPES.join(','),
              onChange: (event) => {
                onProof(event.currentTarget.files?.[0] ?? null);
              },
            }}
          />
        </>
      )}
    </>
  );
}

const SUBMIT: Record<Step['kind'], string> = {
  number: 'המשך',
  confirm: 'כן, זה הספק',
  proof: 'שליחה לאישור',
};

/** Three steps (spec 6.2): the number, "is this your supplier?", and a proof if needed. */
export function LinkWizard() {
  const [step, setStep] = useState<Step>({ kind: 'number' });
  const [proof, setProof] = useState<File | null>(null);
  const number = useState('');
  const [error, action, pending] = useStep(step, setStep, proof);
  return (
    <form action={action} aria-label="שיוך לספק" className={styles.panel}>
      <h2>שיוך לספק</h2>
      {error && <Notice tone="error" title={error} />}
      <StepFields step={step} onProof={setProof} number={number} />
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel="בודק…" data-usage="portal.link">
          {SUBMIT[step.kind]}
        </Button>
        {step.kind !== 'number' && (
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              setStep({ kind: 'number' });
            }}
          >
            לא, מספר אחר
          </Button>
        )}
      </FormActions>
    </form>
  );
}
