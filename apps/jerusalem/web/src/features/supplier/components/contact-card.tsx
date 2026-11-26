import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { contactLink } from '../model/contact-links.ts';
import { contactLabel, sortContacts, splitPhones } from '../model/contact-order.ts';
import { Icon } from '../../../ui/icon.tsx';
import { CopyButton } from './copy-button.tsx';
import { KindIcon } from './kind-icon.tsx';
import styles from './supplier.module.css';

type Contact = SupplierDetail['contacts'][number];
/** One line on the card: a contact, or one number of a contact that holds several. */
interface Line {
  key: string;
  item: Contact;
  value: string;
  split: boolean;
}

function lines(contacts: readonly Contact[]): Line[] {
  const parts = contacts.flatMap((item) => {
    const values = item.kind === 'phone' ? splitPhones(item.value) : [item.value];
    return values.map((value, index) => ({
      key: `${item.id}:${String(index)}`,
      item,
      kind: item.kind,
      value,
      split: values.length > 1,
    }));
  });
  return sortContacts(parts);
}

/** Spec 4.6: an address that the map did not find stays visible, with a note. */
function unmapped(item: Contact): boolean {
  return item.map?.result === 'not_found' || item.map?.result === 'approximate';
}

function Value({ item, text }: { item: Contact; text: string }) {
  const link = contactLink(item.kind, text);
  const value = <bdi>{text}</bdi>;
  if (!link) return value;
  // An address opens in Google Maps, like a website opens in a new tab (Menash, 18.11).
  const external = item.kind === 'website' || item.kind === 'address';
  return (
    <a href={link} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {value}
    </a>
  );
}

/** Spec section 4.3: each detail on its own line, clickable, with a copy button. */
export function ContactCard({ contacts }: { contacts: SupplierDetail['contacts'] }) {
  const hasPhone = contacts.some((item) => item.kind === 'phone');
  return (
    <section className={styles.card} aria-labelledby="supplier-contact">
      <h2 id="supplier-contact">יצירת קשר</h2>
      <ul className={styles.contacts}>
        {lines(contacts).map(({ key, item, value, split }) => {
          const label = contactLabel(item.kind, value);
          return (
            <li key={key}>
              <span className={styles.kind}>
                <KindIcon kind={item.kind} value={value} />
                <span className={styles.visuallyHidden}>{label}</span>
              </span>
              <span className={styles.value}>
                <Value item={item} text={value} />
                {/* A value that held two numbers was invalid only as a whole. */}
                {item.is_valid === false && !split && (
                  <span className={styles.warn}>ייתכן שאינו תקין</span>
                )}
                {unmapped(item) && <span className={styles.warn}>הכתובת לא אותרה במפה</span>}
              </span>
              <CopyButton value={value} label={label} />
            </li>
          );
        })}
        {!hasPhone && (
          <li className={styles.missing}>
            <span className={styles.kind}>
              <Icon name="phone" />
            </span>
            <span className={styles.value}>אין טלפון במאגר</span>
          </li>
        )}
      </ul>
    </section>
  );
}
