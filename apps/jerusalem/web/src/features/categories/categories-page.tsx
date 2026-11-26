import { useLoaderData, useNavigation } from 'react-router';
import { EmptyState } from '../../ui/empty-state.tsx';
import { PageHeader } from '../../ui/page-header.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';
import { CATEGORY_REQUESTS_KEY, loadRequests } from './api/requests.ts';
import { getScreenData } from '../../data/screen-data.ts';
import { useScreenData } from '../../data/react-screen-data.ts';
import { RequestCard } from './components/request-card.tsx';
import styles from './components/request.module.css';
export const loader = () => getScreenData(CATEGORY_REQUESTS_KEY, loadRequests);
export function CategoriesPage() {
  const data = useScreenData(
      CATEGORY_REQUESTS_KEY,
      useLoaderData<typeof loader>(),
      loadRequests,
    ).value,
    navigation = useNavigation();
  return (
    <div className={styles.list}>
      <PageHeader
        title={`בקשות קטגוריה (${String(data.requests.length)})`}
        lead="כל בקשה מאושרת כקטגוריה חדשה, מקושרת לקטגוריה קיימת או נדחית, ותמיד עם נימוק."
        back={{ to: '/admin', label: 'ניהול' }}
      />
      {navigation.state === 'loading' ? (
        <Skeleton />
      ) : data.requests.length === 0 ? (
        <EmptyState title="אין בקשות קטגוריה ממתינות">
          <p>כל הבקשות הקיימות טופלו.</p>
        </EmptyState>
      ) : (
        data.requests.map((request) => (
          <RequestCard key={request.id} request={request} categories={data.categories} />
        ))
      )}
    </div>
  );
}
