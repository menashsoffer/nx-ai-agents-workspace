import { useDeferredValue, useState } from 'react';
import { DataTable } from '../../../ui/data-table.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import type { LoadControl } from '../api/control.ts';
import { jobStatus, registryStatus, when } from '../model/labels.ts';
import { listRegistries } from '../model/registries.ts';
import styles from './control.module.css';

const TONE: Record<string, string | undefined> = {
  active: styles.ok,
  closed: styles.muted,
  ok: styles.ok,
  failed: styles.bad,
  running: styles.muted,
};
function Tag({ status, label }: { status: string; label: string }) {
  return (
    <span className={`${styles.tag ?? ''} ${TONE[status] ?? styles.muted ?? ''}`}>{label}</span>
  );
}

export function RegistryTable({ registries }: Pick<LoadControl, 'registries'>) {
  const [query, setQuery] = useState('');
  const shown = listRegistries(registries, useDeferredValue(query));
  return (
    <section className={styles.section} aria-label="מאגרים">
      <search>
        <FormField
          field={{ label: 'חיפוש מאגר' }}
          input={{
            type: 'search',
            value: query,
            onChange: (e) => {
              setQuery(e.currentTarget.value);
            },
          }}
        />
      </search>
      {shown.length === 0 ? (
        <p>אין מאגר שמתאים לחיפוש.</p>
      ) : (
        <DataTable
          caption={`מאגרים (${String(shown.length)}), לפי מספר השיוכים בבדיקה`}
          columns={[
            { id: 'name', label: 'מאגר' },
            { id: 'status', label: 'מצב' },
            { id: 'memberships', label: 'שיוכים' },
            { id: 'review', label: 'בבדיקה' },
            { id: 'verified', label: 'מאומתים' },
          ]}
          rows={shown.map((r) => ({
            id: r.name,
            cells: {
              name: r.name,
              status: <Tag status={r.status} label={registryStatus(r.status)} />,
              memberships: r.memberships,
              review: r.needs_review,
              verified: r.verified,
            },
          }))}
        />
      )}
    </section>
  );
}

function JobTable({ jobs }: Pick<LoadControl, 'jobs'>) {
  return (
    <DataTable
      caption="הרצות אחרונות"
      columns={[
        { id: 'job', label: 'משימה' },
        { id: 'status', label: 'מצב' },
        { id: 'started', label: 'התחילה' },
        { id: 'finished', label: 'הסתיימה' },
      ]}
      rows={jobs.map((job, index) => ({
        id: String(index),
        cells: {
          job: <bdi>{job.job}</bdi>,
          status: <Tag status={job.status} label={jobStatus(job.status)} />,
          started: when(job.started_at),
          finished: when(job.finished_at),
        },
      }))}
    />
  );
}

function BatchTable({ batches }: Pick<LoadControl, 'batches'>) {
  if (!batches.length) return <p>אין טעינות קבצים רשומות.</p>;
  return (
    <DataTable
      caption="טעינות קבצים"
      columns={[
        { id: 'script', label: 'טעינה' },
        { id: 'rows', label: 'שורות' },
        { id: 'pending', label: 'ממתינות' },
        { id: 'duplicates', label: 'כפילויות' },
        { id: 'created', label: 'נטען' },
      ]}
      rows={batches.map((batch, index) => ({
        id: String(index),
        cells: {
          script: <bdi>{batch.script_name}</bdi>,
          rows: batch.row_count,
          pending: batch.pending,
          duplicates: batch.duplicates,
          created: when(batch.created_at),
        },
      }))}
    />
  );
}

const failedText = (n: number) =>
  n === 0 ? '' : n === 1 ? ' (הרצה אחת נכשלה)' : ` (${String(n)} הרצות נכשלו)`;

/** Runs and file loads matter when something broke, so they stay closed by default. */
export function TechnicalDetails({ jobs, batches }: Pick<LoadControl, 'jobs' | 'batches'>) {
  const failed = jobs.filter((job) => job.status === 'failed').length;
  return (
    <details className={styles.details}>
      <summary>פרטים טכניים{failedText(failed)}</summary>
      <JobTable jobs={jobs} />
      <BatchTable batches={batches} />
    </details>
  );
}
