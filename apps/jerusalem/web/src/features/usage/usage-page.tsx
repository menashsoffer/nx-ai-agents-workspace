// usage-analytics-spec-he.md 4.3: how many came in, what they used, where they clicked and
// where visits ended. Admins only; the numbers come from the database already summed.
import { useLoaderData } from 'react-router';
import { PageHeader } from '../../ui/page-header.tsx';
import { loadUsage } from './api/usage.ts';
import { Filters } from './components/filters.tsx';
import { Stats } from './components/stats.tsx';
import { ActionsTable, DaysTable, FunnelTables, ScreensTable } from './components/tables.tsx';
import { dayRows, funnels, screenRows, totals } from './model/summary.ts';
import styles from './components/usage.module.css';

export const loader = loadUsage;

export function UsagePage() {
  const { range, summary } = useLoaderData<typeof loader>();
  return (
    <div className={styles.page}>
      <PageHeader
        title="שימוש באתר"
        lead="כמה נכנסו, מה עושים ואיפה עוזבים. בלי שמות: רק תפקיד, מסך ופעולה."
        back={{ to: '/admin', label: 'ניהול' }}
      />
      <Filters range={range} />
      <Stats totals={totals(summary, range)} />
      <DaysTable rows={dayRows(summary, range)} />
      <ScreensTable rows={screenRows(summary)} />
      <ActionsTable actions={summary.actions} />
      <FunnelTables funnels={funnels(summary)} />
    </div>
  );
}
