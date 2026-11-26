import { Icon } from '../../../ui/icon.tsx';
import { contactIcon } from '../model/contact-order.ts';

/** Lucide "smartphone" (ISC). Kept here, not in ui/icon.tsx, so the first page stays in budget. */
const MOBILE = [
  'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z',
  'M12 18h.01',
];

/** The icon of a contact's kind; a mobile number gets a phone handset of its own. */
export function KindIcon({ kind, value }: { kind: string; value: string }) {
  const name = contactIcon(kind, value);
  if (name !== 'mobile') return <Icon name={name} />;
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {MOBILE.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
