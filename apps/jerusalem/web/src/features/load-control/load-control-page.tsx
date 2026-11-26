import { useLoaderData } from 'react-router';
import { PageHeader } from '../../ui/page-header.tsx';
import { loadControl } from './api/control.ts';
import { RegistryTable, TechnicalDetails } from './components/control-tables.tsx';
import { StatCards } from './components/stat-cards.tsx';
import styles from './components/control.module.css';

export const loader = loadControl;

export function LoadControlPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className={styles.page}>
      <PageHeader
        title="בקרת טעינה"
        lead="מה נטען למסד ומה עוד ממתין לבדיקה, לפי רישומי הטעינה במסד."
        back={{ to: '/admin', label: 'ניהול' }}
      />
      <StatCards data={data} />
      <RegistryTable registries={data.registries} />
      <TechnicalDetails jobs={data.jobs} batches={data.batches} />
    </div>
  );
}
