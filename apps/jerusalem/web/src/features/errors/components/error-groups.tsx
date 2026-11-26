// error-details-spec-he.md section 4: one expandable item per cause, built from <details>.
import { DataTable } from '../../../ui/data-table.tsx';
import { when } from '../../../lib/dates.ts';
import { FAILURES, failureSentence, type FailureKind } from '../../../lib/errors/failure.ts';
import { kindLabel } from '../../../lib/errors/kind-labels.ts';
import { roleLabel, screenLabel } from '../../../lib/screen-names.ts';
import type { ErrorGroup } from '../model/groups.ts';
import { causeLabel, deviceLabel, sentence, whereLabel } from '../model/labels.ts';
import styles from './errors.module.css';

/** The most recent cases a group lists. */
const SHOWN_CASES = 20;

function shownText(kind: string): string {
  const known = Object.keys(FAILURES).find((key): key is FailureKind => key === kind);
  return known ? failureSentence(FAILURES[known]) : kindLabel(kind);
}

function Facts({ group }: { group: ErrorGroup }) {
  const facts = [
    ['מה המשתמש ראה', `${shownText(group.kind)} (${whereLabel(group.boundary)})`],
    ['ראשונה', when(group.first)],
    ['אחרונה', when(group.last)],
    ['כמה תפקידים נתקלו', String(group.roles)],
    ['גרסת האתר האחרונה', group.version ?? 'לא נרשמה'],
  ];
  return (
    <dl className={styles.facts}>
      {facts.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ group }: { group: ErrorGroup }) {
  return (
    <details className={styles.group}>
      <summary>
        <span className={styles.count}>{group.cases.length}</span>
        <span className={styles.title}>
          {`${screenLabel(group.screen)}: ${causeLabel(group.cause)}`}
        </span>
        {group.urgent && <span className={styles.urgent}>דורש טיפול</span>}
        <span className={styles.last}>{`אחרונה: ${when(group.last)}`}</span>
      </summary>
      <div className={styles.body}>
        <p>{sentence(group)}</p>
        <Facts group={group} />
        <DataTable
          caption={`המקרים האחרונים (עד ${String(SHOWN_CASES)})`}
          columns={[
            { id: 'at', label: 'מתי' },
            { id: 'role', label: 'תפקיד' },
            { id: 'device', label: 'מכשיר' },
            { id: 'version', label: 'גרסה' },
          ]}
          rows={group.cases.slice(0, SHOWN_CASES).map((item) => ({
            id: String(item.id),
            cells: {
              at: when(item.created_at),
              role: item.role ? roleLabel(item.role) : '—',
              device: deviceLabel(item.device),
              version: item.site_version ?? '—',
            },
          }))}
        />
      </div>
    </details>
  );
}

export function ErrorGroups({ groups }: { groups: ErrorGroup[] }) {
  return (
    <section className={styles.section} aria-labelledby="error-groups-title">
      <h2 id="error-groups-title">שגיאות לפי סיבה</h2>
      <div className={styles.groups}>
        {groups.map((group) => (
          <Group key={group.id} group={group} />
        ))}
      </div>
    </section>
  );
}
