import type { Supplier } from '../../../catalog-model.ts';
import { venueFacts, type VenueIcon } from '../model/card-labels.ts';
import styles from './catalog.module.css';

// Simple line icons drawn with currentColor; the text next to each one carries the meaning.
const PATHS: Record<VenueIcon, string> = {
  seats: 'M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M4 11h16v5H4zM6 16v4M18 16v4',
  size: 'M4 4h16v16H4zM4 9h16M9 4v16',
  stage: 'M3 18h18M5 18V9l7-4 7 4v9',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
  sound: 'M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  lighting: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z',
};

export function VenueFacts({ venue }: { venue: Supplier['venue'] }) {
  const facts = venueFacts(venue);
  if (!facts.length) return null;
  return (
    <ul className={styles.venue} aria-label="פרטי המתקן">
      {facts.map((fact) => (
        <li key={fact.text}>
          {fact.icon && (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d={PATHS[fact.icon]} />
            </svg>
          )}
          {fact.text}
        </li>
      ))}
    </ul>
  );
}
