import type { ReactNode } from 'react';
interface Props {
  children?: ReactNode;
}
export function StatusMessage({ children }: Props) {
  return (
    <p role="status" aria-atomic="true">
      {children}
    </p>
  );
}
