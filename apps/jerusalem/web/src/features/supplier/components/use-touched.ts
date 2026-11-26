import { useCallback, useState } from 'react';

/** Typing, choosing or pressing a trash can: anything that may give the save something to do. */
function touches(event: Event): boolean {
  if (event.type !== 'click') return true;
  return event.target instanceof Element && event.target.closest('[aria-pressed]') !== null;
}

/**
 * Save stays off until the form is touched (Menash, 25.11.2026), instead of answering
 * "אין שינויים לשמירה" to a press on an untouched form. A callback ref, because the form is
 * remounted after each save.
 */
export function useTouched() {
  const [touched, setTouched] = useState(false);
  const form = useCallback((element: HTMLFormElement | null) => {
    if (!element) return;
    const touch = (event: Event) => {
      if (touches(event)) setTouched(true);
    };
    element.addEventListener('input', touch);
    element.addEventListener('click', touch);
    return () => {
      element.removeEventListener('input', touch);
      element.removeEventListener('click', touch);
    };
  }, []);
  return { touched, setTouched, form };
}
