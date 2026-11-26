import type { ReactNode } from 'react';
import styles from './panel.module.css';
interface Props {
  title: string;
  children?: ReactNode;
}
export function EmptyState({ title, children }: Props) {
  return (
    <section className={styles.panel}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
