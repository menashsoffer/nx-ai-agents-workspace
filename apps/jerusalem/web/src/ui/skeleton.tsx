import styles from './loading.module.css';

/** `cards` mirrors the catalog grid, `detail` the supplier page, `rows` a list of admin items. */
export type SkeletonShape = 'cards' | 'detail' | 'rows';
interface Props {
  label?: string;
  shape?: SkeletonShape;
}

const COUNT: Record<SkeletonShape, number> = { cards: 6, detail: 2, rows: 3 };

function PlaceholderCard({ tags }: { tags: boolean }) {
  return (
    <div className={styles.card}>
      <span className={[styles.line, styles.title].join(' ')} />
      <span className={styles.line} />
      <span className={[styles.line, styles.short].join(' ')} />
      {tags && (
        <span className={styles.tags}>
          <span className={styles.line} />
          <span className={styles.line} />
        </span>
      )}
    </div>
  );
}

/**
 * Placeholders in the shape of the content that is on its way, so nothing jumps when it lands.
 * Screen readers hear the label once; the shapes are hidden from them.
 */
export function Skeleton({ label = 'טוען נתונים…', shape = 'rows' }: Props) {
  const cards = Array.from({ length: COUNT[shape] }, (_, index) => (
    <PlaceholderCard key={index} tags={shape !== 'rows'} />
  ));
  return (
    <div className={styles.skeleton} role="status">
      <span className={styles.visuallyHidden}>{label}</span>
      <div className={shape === 'cards' ? styles.cards : styles.skeleton} aria-hidden>
        {cards}
      </div>
    </div>
  );
}
