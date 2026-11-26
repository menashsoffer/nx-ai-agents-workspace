// error-details-spec-he.md section 4: what each error people saw was. Administrators only.
import { useLoaderData } from 'react-router';
import { EmptyState } from '../../ui/empty-state.tsx';
import { PageHeader } from '../../ui/page-header.tsx';
import { loadErrors, type ErrorsData } from './api/errors.ts';
import { ErrorGroups } from './components/error-groups.tsx';
import { Filters } from './components/filters.tsx';
import styles from './components/errors.module.css';

export const loader = loadErrors;

function Stats({ data }: { data: ErrorsData }) {
  const urgent = data.groups.filter((g) => g.urgent);
  const items = [
    { label: 'שגיאות', value: data.total },
    { label: 'סיבות שונות', value: data.groups.length },
    { label: 'דורשות טיפול', value: urgent.reduce((sum, g) => sum + g.cases.length, 0) },
  ];
  return (
    <ul className={styles.stats} aria-label="סיכום">
      {items.map((item) => (
        <li key={item.label} className={styles.stat}>
          <span className={styles.value}>{item.value.toLocaleString('he-IL')}</span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function ErrorsPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className={styles.page}>
      <PageHeader
        title="שגיאות באתר"
        lead="כל שגיאה שמישהו ראה באתר: איפה, מה נכשל ומתי. בלי שמות ובלי תוכן: רק תפקיד ומכשיר."
        back={{ to: '/admin', label: 'ניהול' }}
      />
      <Filters view={data.view} />
      <Stats data={data} />
      {data.groups.length === 0 ? (
        <EmptyState title="אין שגיאות בתקופה הזו">
          <p>כשמישהו יראה הודעת שגיאה באתר, היא תופיע כאן.</p>
        </EmptyState>
      ) : (
        <ErrorGroups groups={data.groups} />
      )}
    </div>
  );
}
