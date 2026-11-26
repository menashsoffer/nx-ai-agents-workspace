// Saved requests and checking one again on another date (screens-spec-he.md 2.ב).
import { useActionState, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { DataTable } from '../../../ui/data-table.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { EmptyState } from '../../../ui/empty-state.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import type { IconName } from '../../../ui/icon.tsx';
import { IconButton } from '../../../ui/icon-button.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import { checkRoute } from '../api/check.ts';
import type { SavedRequest } from '../api/saved.ts';
import { money, STATUS_LABELS, type CheckResult } from '../model/result.ts';
import { CANCEL_REQUEST, CancelRequest, editable } from './request-changes.tsx';
import { REQUEST_APPROACHES, RequestApproaches } from './request-approaches.tsx';
import { ResultPanel } from './result-panel.tsx';
import styles from './route-check.module.css';

interface Props {
  requests: SavedRequest[];
  /** A change was saved but the list could not be fetched again. */
  stale?: boolean;
  units: Map<string, string>;
  today: string;
  /** Opens the request in the details form above the list. */
  edit: (request: SavedRequest) => void;
}
const RECHECK = 'recheck-request';
const COLUMNS = [
  { id: 'subject', label: 'נושא' },
  { id: 'unit', label: 'יחידה' },
  { id: 'value', label: 'אומדן' },
  { id: 'date', label: 'תאריך' },
  { id: 'status', label: 'הבדיקה האחרונה' },
  { id: 'action', label: 'פעולות', actions: true },
];

function Recheck({ request, unit, today }: { request: SavedRequest; unit: string; today: string }) {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, action, pending] = useActionState(async (_: string, form: FormData) => {
    try {
      const on = form.get('on');
      setResult(await checkRoute({ request_id: request.id, on: typeof on === 'string' ? on : '' }));
      return '';
    } catch (cause) {
      return errorText(cause);
    }
  }, '');
  return (
    <form action={action} aria-label="בדיקה מחדש" className={styles.form}>
      <p className={styles.summary}>
        {unit} · <bdi>{money(request.estimated_value)}</bdi>{' '}
        {request.value_includes_vat ? 'כולל מע״מ' : 'ללא מע״מ'}
        {request.requested_exemption && (
          <>
            {' '}
            · פטור מבוקש <bdi>{request.requested_exemption}</bdi>
          </>
        )}
      </p>
      {error && <Notice tone="error" title={error} />}
      <FormField
        field={{ label: 'תאריך לבדיקה' }}
        input={{ name: 'on', type: 'date', required: true, dir: 'ltr', defaultValue: today }}
      />
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel="בודק…">
          בדיקת המסלול
        </Button>
      </FormActions>
      {result && <ResultPanel result={result} />}
    </form>
  );
}

function statusText(request: SavedRequest): string {
  if (request.status === 'awarded') return 'נבחר זוכה';
  if (!request.lastStatus) return 'טרם נבדקה';
  const label = STATUS_LABELS[request.lastStatus];
  return request.changedSinceCheck ? `${label} (הפרטים שונו מאז, כדאי לבדוק שוב)` : label;
}

type Mode = 'recheck' | 'approaches' | 'edit' | 'cancel';
/** Edit has no dialog: it opens the details form (owner's request, 18.11). */
const DIALOGS: Record<Mode, { id: string | null; title: string; icon: IconName }> = {
  recheck: { id: RECHECK, title: 'בדיקה מחדש', icon: 'refresh' },
  approaches: { id: REQUEST_APPROACHES, title: 'פניות ותשובות', icon: 'mail' },
  edit: { id: null, title: 'עריכת הבקשה', icon: 'pencil' },
  cancel: { id: CANCEL_REQUEST, title: 'ביטול הבקשה', icon: 'trash' },
};

function commandFor(target: string | null) {
  return target ? { command: { target, action: 'show-modal' as const } } : {};
}

/** Icon buttons: the full name for screen readers, the short one in the bubble (DESIGN.md 6.2). */
function RowActions({ request, choose }: { request: SavedRequest; choose: (m: Mode) => void }) {
  const modes: Mode[] =
    request.status === 'awarded'
      ? ['approaches']
      : editable(request)
        ? ['recheck', 'approaches', 'edit', 'cancel']
        : ['recheck', 'approaches', 'cancel'];
  return (
    <div className={styles.rowActions}>
      {modes.map((mode) => (
        <IconButton
          key={mode}
          icon={DIALOGS[mode].icon}
          label={`${DIALOGS[mode].title}: ${request.subject}`}
          tip={DIALOGS[mode].title}
          {...commandFor(DIALOGS[mode].id)}
          onClick={() => {
            choose(mode);
          }}
        />
      ))}
    </div>
  );
}

type Chosen = { request: SavedRequest; mode: Mode } | null;

function titled(mode: Mode, chosen: Chosen): string {
  return chosen?.mode === mode
    ? `${DIALOGS[mode].title}: ${chosen.request.subject}`
    : DIALOGS[mode].title;
}

function RequestDialogs({
  chosen,
  unitName,
  today,
}: {
  chosen: Chosen;
  unitName: (r: SavedRequest) => string;
  today: string;
}) {
  const request = chosen?.request;
  return (
    <>
      <Dialog id={RECHECK} title={titled('recheck', chosen)}>
        {request && chosen.mode === 'recheck' && (
          <Recheck key={request.id} request={request} unit={unitName(request)} today={today} />
        )}
      </Dialog>
      <Dialog id={REQUEST_APPROACHES} title={titled('approaches', chosen)}>
        {request && chosen.mode === 'approaches' && (
          <RequestApproaches
            key={request.id}
            requestId={request.id}
            today={today}
            status={request.status}
          />
        )}
      </Dialog>
      <Dialog id={CANCEL_REQUEST} title={titled('cancel', chosen)}>
        {request && chosen.mode === 'cancel' && (
          <CancelRequest key={request.id} request={request} />
        )}
      </Dialog>
    </>
  );
}

export function SavedRequests({ requests, stale = false, units, today, edit }: Props) {
  const [chosen, setChosen] = useState<Chosen>(null);
  const unitName = (r: SavedRequest) => units.get(r.unit_id) ?? 'יחידה לא זמינה';
  const rows = requests.map((r) => ({
    id: r.id,
    cells: {
      subject: r.subject,
      unit: unitName(r),
      value: <bdi>{money(r.estimated_value)}</bdi>,
      date: dayOf(r.created_at),
      status: statusText(r),
      action: (
        <RowActions
          request={r}
          choose={(mode) => {
            if (mode === 'edit') edit(r);
            else setChosen({ request: r, mode });
          }}
        />
      ),
    },
  }));
  return (
    <section aria-labelledby="saved-requests" className={styles.panel}>
      <h2 id="saved-requests">בקשות שמורות</h2>
      {stale && (
        <Notice tone="warning" title="הרשימה לא התעדכנה.">
          השינוי נשמר, אבל לא ניתן היה לטעון את הרשימה מחדש. רענון הדף יציג אותה מעודכנת.
        </Notice>
      )}
      {requests.length ? (
        <DataTable caption="בקשות שמורות ביחידות שלך" columns={COLUMNS} rows={rows} />
      ) : (
        <EmptyState title="אין בקשות שמורות">
          <p>בקשה נשמרת כשבוחרים לה יחידה בשלב פרטי הבקשה.</p>
        </EmptyState>
      )}
      <RequestDialogs chosen={chosen} unitName={unitName} today={today} />
    </section>
  );
}
