import type { IsoDate } from '../_shared/procurement/index.ts';

// Regulation 2: the amounts change on the 16th of each month and use the CPI of
// the previous month, which CBS publishes on the 15th.

export interface Period {
  /** The 16th of the month the row starts in. */
  readonly startsOn: IsoDate;
  /** The CPI month that the row uses. */
  readonly year: number;
  readonly month: number;
}

function periodFrom(year: number, monthIndex: number): Period {
  const start = new Date(Date.UTC(year, monthIndex, 16));
  const index = new Date(Date.UTC(year, monthIndex - 1, 1));
  return {
    startsOn: start.toISOString().slice(0, 10),
    year: index.getUTCFullYear(),
    month: index.getUTCMonth() + 1,
  };
}

/** The period in force today and the one after it. */
export function periodsAround(today: IsoDate): [Period, Period] {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const current = day >= 16 ? month - 1 : month - 2;
  return [periodFrom(year, current), periodFrom(year, current + 1)];
}
