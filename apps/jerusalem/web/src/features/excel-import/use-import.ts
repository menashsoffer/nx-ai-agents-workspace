// The import screen's steps (spec section 6) and the calls between them.
import { useState } from 'react';
import { errorText } from '../../data/errors.ts';
import { approve, batchRows, reopen, stage, uploadSource, type ImportRow } from './api/import.ts';
import type { Target } from './api/import.ts';
import type { ReviewRow } from './model/decisions.ts';
import { draftRows, freshRows } from './model/flow.ts';
import type { OpenedFile } from './model/read.ts';
import { sha256, type StagedRow } from './model/rows.ts';

export type Step =
  | { kind: 'file' }
  | { kind: 'mapping'; file: OpenedFile; target: Target }
  | { kind: 'review'; batchId: string; rows: ReviewRow[] }
  | { kind: 'done'; batchId: string; result: Result; rows: ImportRow[] };
interface Result {
  promoted: number;
  failed: number;
  pending: number;
}

const TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

async function draftStep(batchId: string): Promise<Step> {
  const [staged, rows] = await Promise.all([reopen(batchId), batchRows(batchId)]);
  return { kind: 'review', batchId, rows: draftRows(staged, rows) };
}

async function saveDraft(file: OpenedFile, target: Target, sent: StagedRow[]): Promise<Step> {
  const digest = await sha256(file.bytes);
  const path = `excel/${digest}.${file.kind}`;
  await uploadSource(path, file.bytes, TYPES[file.kind]);
  const staged = await stage({ name: file.name, path, sha256: digest }, target, sent);
  if (staged.duplicate && staged.batch_id) return draftStep(staged.batch_id);
  if (staged.duplicate || !staged.batch_id) throw new Error('duplicate-source');
  return { kind: 'review', batchId: staged.batch_id, rows: freshRows(staged, sent) };
}

const DUPLICATE = 'הקובץ הזה כבר נשמר כמסמך מקור בטעינה אחרת, ולכן לא נוצרה טיוטה חדשה.';

function failure(error: unknown): string {
  return error instanceof Error && error.message === 'duplicate-source'
    ? DUPLICATE
    : errorText(error);
}

export function useImport() {
  const [step, setStep] = useState<Step>({ kind: 'file' });
  const [message, setMessage] = useState('');
  async function run(next: () => Promise<Step>): Promise<string> {
    try {
      setStep(await next());
      setMessage('');
      return '';
    } catch (error) {
      return failure(error);
    }
  }
  return {
    step,
    message,
    setStep,
    openDraft: (batchId: string) =>
      void run(() => draftStep(batchId)).then((text) => {
        setMessage(text);
      }),
    save: (file: OpenedFile, target: Target, rows: StagedRow[]) =>
      run(() => saveDraft(file, target, rows)),
    approve: (batchId: string, rows: ReviewRow[]) =>
      run(async () => {
        const decided = rows.map((r) => ({ rowId: r.rowId, choice: r.choice, edited: r.edited }));
        const result = await approve(batchId, decided);
        return { kind: 'done', batchId, result, rows: await batchRows(batchId) };
      }),
  };
}
