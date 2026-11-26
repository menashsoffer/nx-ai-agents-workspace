import { dayOf } from '../../../lib/dates.ts';
import type { Approach } from '../api/approaches.ts';
import type { Members } from '../api/members.ts';
import type { Proposal, SupplierFile } from '../api/portal.ts';
import type { KindRow } from '../model/documents.ts';
import { missingTasks, orderedMemberships } from '../model/missing.ts';
import { CONTACT_LABELS, SCHEME_LABELS, validity } from '../model/portal-model.ts';
import { MissingTasks } from './missing-tasks.tsx';
import { MyApproaches } from './my-approaches.tsx';
import { MyDocuments } from './my-documents.tsx';
import { MyRequests } from './my-requests.tsx';
import { OurPeople } from './our-people.tsx';
import { ProposeFix } from './propose-fix.tsx';
import styles from './area.module.css';

const UNTIL: Record<ReturnType<typeof validity>, (until: string) => string> = {
  open: () => 'בלי תאריך סיום',
  valid: (until) => `בתוקף עד ${dayOf(until)}`,
  soon: (until) => `מסתיים ב-${dayOf(until)}`,
  ended: (until) => `הסתיים ב-${dayOf(until)}`,
};

function Contacts({ file }: { file: SupplierFile }) {
  return (
    <>
      {file.contacts.map((c) => {
        const label = CONTACT_LABELS[c.kind] ?? c.kind;
        return (
          <div key={c.id}>
            <dt>{label}</dt>
            <dd>
              <bdi>{c.value}</bdi>
              <ProposeFix
                supplierId={file.id}
                target={{
                  kind: 'contact',
                  label,
                  current: c.value,
                  contactKind: c.kind,
                  contactId: c.id,
                }}
              />
            </dd>
          </div>
        );
      })}
    </>
  );
}

function Details({ file, proposals }: { file: SupplierFile; proposals: Proposal[] }) {
  return (
    <section className={styles.panel} aria-labelledby="details-title">
      <h2 id="details-title" tabIndex={-1}>
        הפרטים שלי
      </h2>
      <dl className={styles.facts}>
        <div>
          <dt>שם</dt>
          <dd>
            {file.name}
            <ProposeFix
              supplierId={file.id}
              target={{ kind: 'rename', label: 'שם הספק', current: file.name }}
            />
          </dd>
        </div>
        {file.other_names.length > 0 && (
          <div>
            <dt>שמות נוספים</dt>
            <dd>{file.other_names.join(', ')}</dd>
          </div>
        )}
        {file.identifiers.map((id) => (
          <div key={`${id.scheme}-${id.value}`}>
            <dt>{SCHEME_LABELS[id.scheme] ?? id.scheme}</dt>
            <dd>
              <bdi>{id.value}</bdi> · {id.verified ? 'מאומת' : 'בבדיקה'}
            </dd>
          </div>
        ))}
        <Contacts file={file} />
      </dl>
      <ProposeFix supplierId={file.id} target={{ kind: 'contact', label: 'פרט קשר' }} />
      <p className={styles.muted}>
        העירייה בודקת כל תיקון לפני שהוא נשמר. המזהים מתעדכנים רק דרך היחידה שאיתה אתם עובדים.
      </p>
      <MyRequests proposals={proposals} />
    </section>
  );
}

function Memberships({ file, today }: { file: SupplierFile; today: string }) {
  return (
    <section className={styles.panel} aria-labelledby="registries-title">
      <h2 id="registries-title" tabIndex={-1}>
        המאגרים שלי
      </h2>
      {file.memberships.length === 0 ? (
        <p>הספק לא רשום כרגע באף מאגר של העירייה.</p>
      ) : (
        <ul className={styles.list}>
          {orderedMemberships(file.memberships, today).map((m) => {
            const state = validity(m.registered_until, today);
            return (
              <li key={`${m.registry}-${m.field ?? ''}`} data-state={state}>
                <strong>{m.registry}</strong>
                {m.field && <span> · {m.field}</span>}
                {m.unit && <span className={styles.muted}> · {m.unit}</span>}
                <span className={styles.until}>{UNTIL[state](m.registered_until ?? '')}</span>
                {m.document_url && (
                  <a href={m.document_url} target="_blank" rel="noreferrer">
                    מסמך המאגר
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface Props {
  file: SupplierFile;
  proposals: Proposal[];
  documents: KindRow[];
  members: Members | null;
  approaches: Approach[];
  today: string;
}

/** "התיק שלי" (spec 6.3): how the municipality sees the supplier, and fixes to propose. */
export function MyFile({ file, proposals, documents, members, approaches, today }: Props) {
  return (
    <>
      <header className={styles.title}>
        <h1 tabIndex={-1}>{file.name}</h1>
        <p className={styles.muted}>{file.role === 'owner' ? 'מורשה ספק' : 'עובד ספק'}</p>
      </header>
      <MissingTasks tasks={missingTasks({ file, proposals, documents, approaches }, today)} />
      <MyApproaches supplierId={file.id} approaches={approaches} today={today} />
      <Details file={file} proposals={proposals} />
      <Memberships file={file} today={today} />
      <MyDocuments supplierId={file.id} rows={documents} today={today} />
      {members && <OurPeople supplierId={file.id} list={members} />}
    </>
  );
}
