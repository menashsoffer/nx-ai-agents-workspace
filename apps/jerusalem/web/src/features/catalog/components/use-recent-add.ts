import { useEffect, useState } from 'react';
import { lastAddedAt } from '../../../lib/shortlist.ts';

/** How long the catalog shows its request tray after a supplier is added (Menash, 18.11.2026). */
export const TRAY_MS = 10_000;
/** After the pointer or focus leaves the tray, it stays this long, so it does not vanish. */
const LINGER_MS = 3_000;

/**
 * True for TRAY_MS after the last added supplier. While the pointer or keyboard focus is in the
 * tray it stays open (WCAG 2.2.1: a timed change waits for the user who is using it).
 */
export function useRecentAdd() {
  const [until, setUntil] = useState(() => lastAddedAt() + TRAY_MS);
  const [open, setOpen] = useState(() => Date.now() < until);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!open || held) return undefined;
    const timer = setTimeout(
      () => {
        setOpen(false);
      },
      Math.max(until - Date.now(), 0),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [open, held, until]);
  return {
    open,
    hold: () => {
      setHeld(true);
    },
    release: () => {
      setHeld(false);
      setUntil(Math.max(until, Date.now() + LINGER_MS));
    },
  };
}
