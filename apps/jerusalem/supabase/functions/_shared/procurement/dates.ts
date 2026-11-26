// Legal dates are plain YYYY-MM-DD strings so results never depend on a time zone.

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtc(day: IsoDate): number {
  if (!ISO_DATE.test(day)) {
    throw new Error(`Invalid date ${day}. Expected YYYY-MM-DD`);
  }
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, date);
  if (new Date(time).toISOString().slice(0, 10) !== day) {
    throw new Error(`Invalid date ${day}`);
  }
  return time;
}

function fromUtc(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10);
}

export function parseIsoDate(day: string): IsoDate {
  toUtc(day);
  return day;
}

export function addDays(day: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(day) + days * DAY_MS);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Regulation 2: amounts update on the 16th of each month. */
export function nextUpdateDay(day: IsoDate): IsoDate {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  toUtc(day);
  if (date < 16) {
    return fromUtc(Date.UTC(year, month - 1, 16));
  }
  return fromUtc(Date.UTC(year, month, 16));
}
