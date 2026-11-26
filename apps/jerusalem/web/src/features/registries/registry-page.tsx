import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { EmptyState } from '../../ui/empty-state.tsx';
import { PageHeader } from '../../ui/page-header.tsx';
import { getScreenData } from '../../data/screen-data.ts';
import { useScreenData } from '../../data/react-screen-data.ts';
import { loadReview, reviewKey, type RegistryDetail } from './api/registries.ts';
import { reviewOrder } from './model/review.ts';
import { MemberRow } from './components/member-row.tsx';
import { ValidityForm } from './components/validity-form.tsx';
import styles from './components/registries.module.css';

export async function loader({ params }: LoaderFunctionArgs) {
  const version = params.version ?? '';
  return { version, registry: await getScreenData(reviewKey(version), () => loadReview(version)) };
}

function Members({ registry }: { registry: RegistryDetail }) {
  const members = reviewOrder(registry.members);
  const waiting = members.filter((m) => m.review_status === 'needs_review').length;
  if (members.length === 0)
    return (
      <EmptyState title="אין ספקים במאגר">
        <p>ספקים שייטענו מהמסמך יופיעו כאן.</p>
      </EmptyState>
    );
  return (
    <section aria-label="ספקים במאגר">
      <h2>{`ספקים במאגר (${String(waiting)} ממתינים מתוך ${String(members.length)})`}</h2>
      <ul className={styles.list}>
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            version={registry.version_id}
            registryUntil={registry.valid_until}
          />
        ))}
      </ul>
    </section>
  );
}

/** One registry: its document, its valid-until, and each supplier checked on its own. */
export function RegistryPage() {
  const data = useLoaderData<Awaited<ReturnType<typeof loader>>>();
  const load = () => loadReview(data.version);
  const registry = useScreenData(reviewKey(data.version), data.registry, load).value;
  return (
    <div className={styles.page}>
      <PageHeader
        title={registry.name}
        lead="פותחים את מסמך המאגר, ומסמנים לכל ספק אם הוא מופיע בו."
        back={{ to: '/registries', label: 'אימות מאגרים' }}
      />
      {registry.document && (
        <p>
          <a href={registry.document} target="_blank" rel="noopener noreferrer">
            פתיחת מסמך המאגר
          </a>
        </p>
      )}
      <ValidityForm registry={registry} />
      <Members registry={registry} />
    </div>
  );
}
