import { useLoaderData } from 'react-router';
import { EmptyState } from '../../ui/empty-state.tsx';
import { PageHeader } from '../../ui/page-header.tsx';
import { getScreenData } from '../../data/screen-data.ts';
import { useScreenData } from '../../data/react-screen-data.ts';
import { loadLinks, SUPPLIER_LINKS_KEY, type SupplierLink } from './api/links.ts';
import { loadDocumentQueue, SUPPLIER_DOCUMENTS_KEY, type QueuedDocument } from './api/documents.ts';
import { DocumentRow } from './components/document-row.tsx';
import { LinkRow } from './components/link-row.tsx';
import styles from './components/links.module.css';

export async function loader() {
  const [links, documents] = await Promise.all([
    getScreenData(SUPPLIER_LINKS_KEY, loadLinks),
    getScreenData(SUPPLIER_DOCUMENTS_KEY, loadDocumentQueue),
  ]);
  return { links, documents };
}

function Documents({ documents }: { documents: QueuedDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <section aria-label="מסמכים לבדיקה">
      <h2>{`מסמכים לבדיקה (${String(documents.length)})`}</h2>
      <ul className={styles.list}>
        {documents.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} />
        ))}
      </ul>
    </section>
  );
}

function Group({ title, links }: { title: string; links: SupplierLink[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2>{`${title} (${String(links.length)})`}</h2>
      <ul className={styles.list}>
        {links.map((link) => (
          <LinkRow key={link.id} link={link} />
        ))}
      </ul>
    </section>
  );
}

/** Waiting links, the week's email matches and waiting documents (spec 6.5, 6.10). */
export function SupplierLinksPage() {
  const data = useLoaderData<Awaited<ReturnType<typeof loader>>>();
  const links = useScreenData(SUPPLIER_LINKS_KEY, data.links, loadLinks).value;
  const documents = useScreenData(SUPPLIER_DOCUMENTS_KEY, data.documents, loadDocumentQueue).value;
  return (
    <div className={styles.page}>
      <PageHeader
        title="שיוכים ומסמכים לבדיקה"
        lead="בקשות להיכנס בשם ספק ומסמכים שספקים העלו. שיוך בהתאמת דוא״ל נכנס מיד ומופיע כאן שבוע."
        back={{ to: '/admin', label: 'ניהול' }}
      />
      {links.length === 0 && documents.length === 0 ? (
        <EmptyState title="אין שיוכים ומסמכים לבדיקה">
          <p>כשספק יבקש להיכנס לאזור האישי או יעלה מסמך, זה יופיע כאן.</p>
        </EmptyState>
      ) : (
        <>
          <Group title="ממתינים לאישור" links={links.filter((l) => l.status === 'pending')} />
          <Group
            title="נכנסו בהתאמת דוא״ל השבוע"
            links={links.filter((l) => l.status === 'active')}
          />
          <Documents documents={documents} />
        </>
      )}
    </div>
  );
}
