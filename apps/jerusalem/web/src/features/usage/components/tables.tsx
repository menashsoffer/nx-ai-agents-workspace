// The four tables of the dashboard. Each number has a bar beside it for a quick comparison.
import type { ReactNode } from 'react';
import { DataTable } from '../../../ui/data-table.tsx';
import type { UsageSummary } from '../api/usage.ts';
import { actionLabel, screenLabel } from '../model/labels.ts';
import type { DayRow, Funnel, ScreenRow } from '../model/summary.ts';
import { formatCount, formatDuration, formatShare } from '../model/summary.ts';
import { DaysChart, dayName } from './days-chart.tsx';
import styles from './usage.module.css';

function Bar({ value, max, children }: { value: number; max: number; children: ReactNode }) {
  return (
    <span className={styles.bar}>
      <meter min={0} max={Math.max(max, 1)} value={value} aria-hidden="true" />
      {children}
    </span>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function DaysTable({ rows }: { rows: DayRow[] }) {
  return (
    <Section id="usage-days" title="כניסות לפי יום">
      <div className={styles.card}>
        <DaysChart rows={rows} />
        <details className={styles.more}>
          <summary>הצגה כטבלה</summary>
          <DataTable
            caption="ביקורים ומשתמשים בכל יום, מהישן לחדש"
            columns={[
              { id: 'day', label: 'יום' },
              { id: 'visits', label: 'ביקורים' },
              { id: 'visitors', label: 'משתמשים' },
            ]}
            rows={rows.map((r) => ({
              id: r.day,
              cells: {
                day: dayName.format(new Date(`${r.day}T00:00:00Z`)),
                visits: formatCount(r.visits),
                visitors: formatCount(r.visitors),
              },
            }))}
          />
        </details>
      </div>
    </Section>
  );
}

export function ScreensTable({ rows }: { rows: ScreenRow[] }) {
  const max = Math.max(...rows.map((r) => r.views), 0);
  return (
    <Section id="usage-screens" title="מסכים ונקודות עזיבה">
      {rows.length === 0 ? (
        <p>אין עדיין צפיות בתקופה הזו.</p>
      ) : (
        <DataTable
          caption="לפי מספר הצפיות. עזיבה: אחוז הביקורים שהסתיימו במסך"
          columns={[
            { id: 'screen', label: 'מסך' },
            { id: 'views', label: 'צפיות' },
            { id: 'time', label: 'זמן ממוצע' },
            { id: 'exits', label: 'עזיבה' },
          ]}
          rows={rows.map((r) => ({
            id: r.screen,
            cells: {
              screen: screenLabel(r.screen),
              views: (
                <Bar value={r.views} max={max}>
                  {formatCount(r.views)}
                </Bar>
              ),
              time: formatDuration(r.averageMs),
              exits: formatShare(r.exitShare),
            },
          }))}
        />
      )}
    </Section>
  );
}

export function ActionsTable({ actions }: { actions: UsageSummary['actions'] }) {
  const max = Math.max(...actions.map((a) => a.count), 0);
  return (
    <Section id="usage-actions" title="איפה לוחצים">
      {actions.length === 0 ? (
        <p>אין עדיין לחיצות בתקופה הזו.</p>
      ) : (
        <DataTable
          caption="הפעולות המרכזיות, לפי מספר הלחיצות"
          columns={[
            { id: 'action', label: 'פעולה' },
            { id: 'screen', label: 'מסך' },
            { id: 'count', label: 'לחיצות' },
          ]}
          rows={actions.map((a) => ({
            id: `${a.screen}:${a.action}`,
            cells: {
              action: actionLabel(a.action),
              screen: screenLabel(a.screen),
              count: (
                <Bar value={a.count} max={max}>
                  {formatCount(a.count)}
                </Bar>
              ),
            },
          }))}
        />
      )}
    </Section>
  );
}

export function FunnelTables({ funnels }: { funnels: Funnel[] }) {
  if (funnels.length === 0) return null;
  return (
    <Section id="usage-steps" title="שלבים באשפים">
      {funnels.map((f) => (
        <DataTable
          key={f.screen}
          caption={`${screenLabel(f.screen)}: כמה ביקורים הגיעו לכל שלב`}
          columns={[
            { id: 'step', label: 'שלב' },
            { id: 'visits', label: 'ביקורים' },
            { id: 'share', label: 'מהשלב הנפוץ' },
          ]}
          rows={f.steps.map((s) => ({
            id: String(s.step),
            cells: {
              step: `שלב ${String(s.step)}`,
              visits: formatCount(s.visits),
              share: (
                <Bar value={s.share} max={1}>
                  {formatShare(s.share)}
                </Bar>
              ),
            },
          }))}
        />
      ))}
    </Section>
  );
}
