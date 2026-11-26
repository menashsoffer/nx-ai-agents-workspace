// A new request in three steps (screens-spec-he.md 2.א): suppliers, details, result.
import { useRef, useState } from 'react';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { toggleShortlist } from '../../../lib/shortlist.ts';
import { clearDraft, readDraft, writeDraft } from '../../../lib/form-draft.ts';
import controls from '../../../ui/control.module.css';
import type { EngagementData } from '../api/engagement.ts';
import type { CheckResult } from '../model/result.ts';
import { DraftForm } from './draft-form.tsx';
import { EMPTY_ENTRY, type Entry } from '../model/entry.ts';
import { PickedList } from './picked-list.tsx';
import { ResultPanel } from './result-panel.tsx';
import { ShortlistTools } from './shortlist-tools.tsx';
import { STEPS, Steps, type Step } from './steps.tsx';
import styles from './route-check.module.css';
import { reportStep } from '../../../lib/usage-signal.ts';

interface Checked {
  result: CheckResult;
  requestId: string | null;
  /** Kept from the moment of the check: saving empties the tab's list, and a reload reads it. */
  suppliers: EngagementData['suppliers'];
}

function useWizard() {
  const [step, setStep] = useState<Step>('suppliers');
  const heading = useRef<HTMLHeadingElement>(null);
  function move(next: Step): void {
    setStep(next);
    reportStep(Object.keys(STEPS).indexOf(next) + 1);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return { step, move, heading };
}

const DRAFT = 'engagement-request';
const VALUES = z.object({
  subject: z.string(),
  estimated_value: z.string(),
  vat: z.boolean(),
  requested_exemption: z.string(),
  unit_id: z.string(),
});

/**
 * The details are kept for the tab until the request is saved (state-management-spec-he.md
 * 5.2). A saved request is never kept: the next new request must not edit it.
 */
function useEntry() {
  const [entry, setEntry] = useState<Entry>(() => ({
    values: readDraft(DRAFT, VALUES) ?? EMPTY_ENTRY.values,
    saved: null,
  }));
  /** Clearing remounts the form, whose fields hold what was typed. */
  const [round, setRound] = useState(0);
  function keep(next: Entry): void {
    setEntry(next);
    if (next.saved) clearDraft(DRAFT);
    else writeDraft(DRAFT, next.values);
  }
  function clear(): void {
    setEntry(EMPTY_ENTRY);
    clearDraft(DRAFT);
    setRound((value) => value + 1);
  }
  return { entry, keep, clear, round };
}

function SupplierStep({ data, next }: { data: EngagementData; next: () => void }) {
  const navigate = useNavigate();
  return (
    <>
      <PickedList
        suppliers={data.suppliers}
        remove={(id) => {
          toggleShortlist(id);
          // Drop a shared list from the address so the loader reads the updated one.
          void navigate('/engagement', { replace: true });
        }}
      />
      <FormActions>
        <Button onClick={next} data-usage="request.next">
          המשך
        </Button>
        <Link to="/catalog" className={controls.quiet}>
          להמשך איתור ספקים
        </Link>
      </FormActions>
    </>
  );
}

function ResultStep({
  data,
  checked,
  back,
}: {
  data: EngagementData;
  checked: Checked;
  back: () => void;
}) {
  return (
    <>
      <ResultPanel result={checked.result} />
      <ShortlistTools
        suppliers={checked.suppliers}
        today={data.today}
        requestId={checked.requestId}
      />
      <Button variant="quiet" onClick={back} className={styles.back}>
        חזרה לפרטי הבקשה
      </Button>
    </>
  );
}

export function NewRequest({ data }: { data: EngagementData }) {
  const { step, move, heading } = useWizard();
  const [checked, setChecked] = useState<Checked>();
  const { entry, keep, clear, round } = useEntry();
  return (
    <section aria-labelledby="new-request" className={styles.panel}>
      <h2 id="new-request">בקשה חדשה</h2>
      <Steps current={step} reachable={(key) => key !== 'result' || !!checked} go={move} />
      <h3 tabIndex={-1} ref={heading} className={styles.stepTitle}>
        {STEPS[step]}
      </h3>
      {step === 'suppliers' && (
        <SupplierStep
          data={data}
          next={() => {
            move('details');
          }}
        />
      )}
      {step === 'details' && (
        <DraftForm
          key={round}
          units={data.units}
          today={data.today}
          entry={entry}
          keep={keep}
          clear={clear}
          back={() => {
            move('suppliers');
          }}
          complete={(result, requestId) => {
            setChecked({ result, requestId, suppliers: data.suppliers });
            move('result');
          }}
        />
      )}
      {step === 'result' && checked && (
        <ResultStep
          data={data}
          checked={checked}
          back={() => {
            move('details');
          }}
        />
      )}
    </section>
  );
}
