/** Today's date in Jerusalem as `YYYY-MM-DD`. */
export function israelToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** A timestamp shown in Jerusalem time, or a dash when it is missing. */
export function when(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

/** The day of a timestamp in Jerusalem, as "17.11.2026". */
export function dayOf(value: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

/** A `YYYY-MM-DD` date as "24.12.2026". */
export function dateLabel(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`;
}
