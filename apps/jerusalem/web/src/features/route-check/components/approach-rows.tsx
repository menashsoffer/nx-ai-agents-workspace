// The rows of "פניות ותשובות": each approach, its answer, and what staff can do with it now
// (open the offer file, choose the winner, or record an answer that came by email or phone).
import { useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { StatusMessage } from '../../../ui/status-message.tsx';
import { errorText } from '../../../data/errors.ts';
import { signedFileUrl } from '../../../data/files.ts';
import type { RequestApproach } from '../api/approaches.ts';
import {
  answerText,
  CHANNEL_LABELS,
  comparable,
  recordable,
  shortDay,
} from '../model/approaches.ts';
import { awardable } from './award-form.tsx';

export const COLUMNS = [
  { id: 'supplier', label: 'ספק' },
  { id: 'channel', label: 'ערוץ' },
  { id: 'sent', label: 'נשלחה' },
  { id: 'due', label: 'מועד' },
  { id: 'answer', label: 'תשובה' },
  { id: 'file', label: 'פעולות', actions: true },
];

/** Opened offers first, cheapest first (compared with VAT); the rest keep their order. */
export function ordered(rows: readonly RequestApproach[]): RequestApproach[] {
  const price = (row: RequestApproach) => comparable(row.answer) ?? Number.POSITIVE_INFINITY;
  return [...rows].sort((a, b) => price(a) - price(b));
}

function FileButton({ path, supplier }: { path: string; supplier: string }) {
  const [error, setError] = useState('');
  return (
    <>
      <Button
        variant="quiet"
        aria-label={`פתיחת קובץ ההצעה של ${supplier}`}
        onClick={() => {
          signedFileUrl(path).then(
            (url) => window.open(url, '_blank', 'noopener'),
            (cause: unknown) => {
              setError(errorText(cause));
            },
          );
        }}
      >
        פתיחה
      </Button>
      <StatusMessage>{error}</StatusMessage>
    </>
  );
}

export interface Rows {
  list: RequestApproach[];
  today: string;
  /** The request already has a winner or was cancelled: no more actions on it. */
  closed: boolean;
  record: (row: RequestApproach) => void;
  award: (row: RequestApproach) => void;
}

function AwardButton({ row, award }: { row: RequestApproach; award: Rows['award'] }) {
  return (
    <Button
      variant="quiet"
      aria-label={`בחירת ${row.supplier_name} כזוכה`}
      onClick={() => {
        award(row);
      }}
    >
      בחירה כזוכה
    </Button>
  );
}

function Action({
  row,
  today,
  closed,
  record,
  award,
}: Omit<Rows, 'list'> & { row: RequestApproach }) {
  const file = row.answer?.file_path;
  const pick = !closed && awardable(row) && <AwardButton row={row} award={award} />;
  if (file || pick)
    return (
      <>
        {file && <FileButton path={file} supplier={row.supplier_name} />}
        {pick}
      </>
    );
  if (closed || !recordable(row, today)) return null;
  return (
    <Button
      variant="quiet"
      aria-label={`רישום תשובה של ${row.supplier_name}`}
      onClick={() => {
        record(row);
      }}
    >
      רישום תשובה
    </Button>
  );
}

export function rowsOf({ list, ...actions }: Rows) {
  return ordered(list).map((row) => ({
    id: row.id,
    cells: {
      supplier: row.supplier_name,
      channel: CHANNEL_LABELS[row.channel],
      sent: shortDay(row.approached_on),
      due: row.respond_by ? shortDay(row.respond_by) : 'בלי מועד',
      answer: answerText(row.answer),
      file: <Action row={row} {...actions} />,
    },
  }));
}
