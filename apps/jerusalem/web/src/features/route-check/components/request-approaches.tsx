// "פניות ותשובות" of a saved request (supplier-approaches-spec-he.md 6.2). Before the deadline
// an offer shows only that it came; the database holds back its amount, note and file.
import { useEffect, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { DataTable } from '../../../ui/data-table.tsx';
import { EmptyState } from '../../../ui/empty-state.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { StatusMessage } from '../../../ui/status-message.tsx';
import { errorText } from '../../../data/errors.ts';
import { loadRequestApproaches, type RequestApproach } from '../api/approaches.ts';
import { comparable, extendRange, opensOn, VAT_RATE } from '../model/approaches.ts';
import { ExtendDeadline, RecordAnswer } from './approach-staff.tsx';
import { COLUMNS, rowsOf } from './approach-rows.tsx';
import { AwardForm } from './award-form.tsx';

export { ordered } from './approach-rows.tsx';

export const REQUEST_APPROACHES = 'request-approaches';

function Notes({ list }: { list: RequestApproach[] }) {
  const sealed = list.find((row) => row.sealed && row.answer?.answer === 'offer');
  const opened = list.some((row) => comparable(row.answer) !== null);
  return (
    <>
      {sealed?.respond_by && (
        <Notice tone="info" title={`ההצעות ייפתחו ב-${opensOn(sealed.respond_by)} ב-00:00.`} />
      )}
      {opened && (
        <p>{`הסדר לפי הסכום כולל מע״מ (${String(VAT_RATE * 100)}%), לצורך השוואה בלבד.`}</p>
      )}
    </>
  );
}

type Loaded = { list: RequestApproach[]; error: string } | null;

/** The request's approaches, fetched again whenever `round` changes. */
function useApproaches(requestId: string, round: number): Loaded {
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    let live = true;
    loadRequestApproaches(requestId).then(
      (list) => {
        if (live) setLoaded({ list, error: '' });
      },
      (cause: unknown) => {
        if (live) setLoaded({ list: [], error: errorText(cause) });
      },
    );
    return () => {
      live = false;
    };
  }, [requestId, round]);
  return loaded;
}

type Open =
  | { kind: 'record'; row: RequestApproach }
  | { kind: 'award'; row: RequestApproach }
  | { kind: 'extend' }
  | null;

interface Props {
  requestId: string;
  today: string;
  /** The request's status; an awarded or cancelled one is shown without actions. */
  status: string;
}

function StaffForm({
  open,
  list,
  ...props
}: Props & Done & { open: Open; list: RequestApproach[] }) {
  const range = extendRange(list, props.today);
  if (open?.kind === 'record') return <RecordAnswer key={open.row.id} row={open.row} {...props} />;
  if (open?.kind === 'award') return <AwardForm key={open.row.id} row={open.row} {...props} />;
  if (open?.kind === 'extend' && range) return <ExtendDeadline range={range} {...props} />;
  return null;
}

interface Done {
  done: (message: string) => void;
  cancel: () => void;
}

function ExtendButton({ open }: { open: () => void }) {
  return (
    <Button variant="secondary" onClick={open}>
      הארכת המועד
    </Button>
  );
}

interface Head {
  list: RequestApproach[];
  today: string;
  status: string;
  message: string;
  /** Opens the extension form; null while another form is open or the request is closed. */
  extend: (() => void) | null;
}

function ListHead({ list, today, status, message, extend }: Head) {
  return (
    <>
      <Notes list={list} />
      <StatusMessage>{message}</StatusMessage>
      {status === 'awarded' && <Notice tone="success" title="נבחר זוכה, והבקשה נסגרה." />}
      {extend && extendRange(list, today) && <ExtendButton open={extend} />}
    </>
  );
}

/** Which staff form is open under the table, and the line shown after one is saved. */
function useOpenForm(reload: () => void) {
  const [open, setOpen] = useState<Open>(null);
  const [message, setMessage] = useState('');
  const choose = (next: Open) => {
    setMessage('');
    setOpen(next);
  };
  const done = (text: string) => {
    setOpen(null);
    setMessage(text);
    reload();
  };
  return { open, message, choose, done };
}

function ApproachList({
  list,
  reload,
  ...props
}: Props & { list: RequestApproach[]; reload: () => void }) {
  const { open, message, choose, done } = useOpenForm(reload);
  const act = (kind: 'record' | 'award') => (row: RequestApproach) => {
    choose({ kind, row });
  };
  const closed = props.status === 'awarded' || props.status === 'cancelled';
  return (
    <>
      <ListHead
        list={list}
        today={props.today}
        status={props.status}
        message={message}
        extend={
          open || closed
            ? null
            : () => {
                choose({ kind: 'extend' });
              }
        }
      />
      <DataTable
        caption="פניות ותשובות"
        columns={COLUMNS}
        rows={rowsOf({
          list,
          today: props.today,
          closed,
          record: act('record'),
          award: act('award'),
        })}
      />
      <StaffForm
        open={open}
        list={list}
        {...props}
        done={done}
        cancel={() => {
          choose(null);
        }}
      />
    </>
  );
}

export function RequestApproaches(props: Props) {
  const [round, setRound] = useState(0);
  const loaded = useApproaches(props.requestId, round);
  if (!loaded) return <StatusMessage>טוען פניות…</StatusMessage>;
  if (loaded.error) return <Notice tone="error" title={loaded.error} />;
  if (!loaded.list.length)
    return (
      <EmptyState title="עוד לא נרשמו פניות">
        <p>פנייה נרשמת בשלב 3 של הבקשה, בכפתור &quot;רישום פנייה לספקים&quot;.</p>
      </EmptyState>
    );
  return (
    <ApproachList
      list={loaded.list}
      {...props}
      reload={() => {
        setRound((n) => n + 1);
      }}
    />
  );
}
