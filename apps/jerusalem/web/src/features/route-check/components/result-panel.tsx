import { StatusMessage } from '../../../ui/status-message.tsx';
import styles from './route-check.module.css';
import { STATUS_LABELS, routeLabel, money, type CheckResult } from '../model/result.ts';
interface MessagesProps {
  title: string;
  items: string[];
}
function Messages({ title, items }: MessagesProps) {
  return items.length ? (
    <section>
      <h3>{title}</h3>
      <ul>
        {[...new Set(items)].map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </section>
  ) : null;
}
interface Props {
  result: CheckResult;
}
const TONES = { ok: 'ok', needs_review: 'needs_review', blocked: 'blocked_route' } as const;

export function ResultPanel({ result }: Props) {
  return (
    <section
      aria-label="תוצאת בדיקת המסלול"
      className={[styles.verdict, styles[TONES[result.status]]].join(' ')}
    >
      <StatusMessage>{STATUS_LABELS[result.status]}</StatusMessage>
      <h3>{routeLabel(result.route)}</h3>
      <dl className={styles.facts}>
        {result.comparedValue !== null && (
          <div>
            <dt>הסכום שנבדק מול הספים</dt>
            <dd>
              <bdi>{money(result.comparedValue)}</bdi>
            </dd>
          </div>
        )}
        <div>
          <dt>הגורם המאשר</dt>
          <dd>{result.approver}</dd>
        </div>
        <div>
          <dt>התקנה</dt>
          <dd>
            <bdi>{result.regulation}</bdi>
          </dd>
        </div>
        <div>
          <dt>מקור הספים</dt>
          <dd>{result.thresholdsSource ?? 'לא תועד מקור לספים.'}</dd>
        </div>
      </dl>
      <Messages title="מה נדרש" items={result.requirements} />
      <Messages title="מה חסר" items={result.missing} />
      <Messages title="שימו לב" items={result.warnings} />
    </section>
  );
}
