import { Link, useLoaderData } from 'react-router';
import { DataTable } from '../../ui/data-table.tsx';
import { EmptyState } from '../../ui/empty-state.tsx';
import { PageHeader } from '../../ui/page-header.tsx';
import { getScreenData } from '../../data/screen-data.ts';
import { useScreenData } from '../../data/react-screen-data.ts';
import { loadReviews, REVIEWS_KEY, type RegistryReview } from './api/registries.ts';
import { progress, untilText } from './model/review.ts';
import styles from './components/registries.module.css';

export async function loader() {
  return { reviews: await getScreenData(REVIEWS_KEY, loadReviews) };
}

const COLUMNS = [
  { id: 'name', label: 'מאגר' },
  { id: 'unit', label: 'יחידה' },
  { id: 'until', label: 'תוקף' },
  { id: 'progress', label: 'בדיקה מול המסמך' },
  { id: 'expired', label: 'פג תוקף' },
];

function rows(reviews: RegistryReview[]) {
  return reviews.map((review) => ({
    id: review.version_id,
    cells: {
      name: <Link to={`/registries/${review.version_id}`}>{review.name}</Link>,
      unit: review.unit ?? 'בלי יחידה אחראית',
      until: untilText(review.valid_until),
      progress: progress(review.counts),
      expired: String(review.counts.expired),
    },
  }));
}

/** The registries this user verifies against their documents (stage B, 25.11). */
export function RegistriesPage() {
  const data = useLoaderData<Awaited<ReturnType<typeof loader>>>();
  const reviews = useScreenData(REVIEWS_KEY, data.reviews, loadReviews).value;
  return (
    <div className={styles.page}>
      <PageHeader
        title="אימות מאגרים"
        lead="בודקים כל ספק מול מסמך המאגר, וקובעים עד מתי המאגר בתוקף. ספק שלא אומת מוצג לעובדים כ'לבדוק'."
        back={{ to: '/admin', label: 'ניהול' }}
      />
      {reviews.length === 0 ? (
        <EmptyState title="אין מאגרים לבדיקה">
          <p>מאגר של יחידה שאתם מנהלים יופיע כאן.</p>
        </EmptyState>
      ) : (
        <DataTable caption="מאגרים לאימות" columns={COLUMNS} rows={rows(reviews)} />
      )}
    </div>
  );
}
