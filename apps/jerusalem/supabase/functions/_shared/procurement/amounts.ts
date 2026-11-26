import { addDays, nextUpdateDay, type IsoDate } from './dates.ts';

// Base amounts in the regulations (3(3) and 8) and the base index (regulation 2).
export const BASE_NO_TENDER = 26_000;
export const BASE_ZUTA_4 = 63_500;
export const BASE_ZUTA_6 = 127_000;
export const BASE_INDEX_1985 = 175.3;

/** VAT rate from 1.1.2025. Callers may pass another rate. */
export const DEFAULT_VAT_RATE = 0.18;

export interface Thresholds {
  readonly effectiveFrom: IsoDate;
  /** Up to this amount: exempt under 3(3). */
  readonly noTenderMax: number;
  /** Up to this amount: zuta tender with at least 4 invitations. */
  readonly zuta4Max: number;
  /** Up to this amount: zuta tender with at least 6 invitations. Above it: public tender. */
  readonly zuta6Max: number;
  readonly source: string;
  readonly isOfficial: boolean;
  /** Empty: valid until the day before the next update day. */
  readonly validUntil?: IsoDate;
}

/** A money amount must be a finite number that is not negative (or strictly positive). */
export function requireAmount(value: unknown, name: string, positive = false): number {
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error(`${name} must be a finite number`);
  }
  if (amount < 0 || (positive && amount === 0)) {
    throw new Error(`${name} must be ${positive ? 'positive' : 'zero or more'}`);
  }
  return amount;
}

export function thresholdValidUntil(t: Thresholds): IsoDate {
  return t.validUntil ?? addDays(nextUpdateDay(t.effectiveFrom), -1);
}

/** Round half to even, matching the rounding used to publish the amounts. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) > 1e-9) {
    return Math.round(value);
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Regulation 2: the base amount times the index ratio, rounded to the nearest 100. */
export function indexedAmount(baseAmount: number, indexRatio: number): number {
  return roundHalfEven((baseAmount * indexRatio) / 100) * 100;
}

export function thresholdsFromIndex(
  indexOn1985Base: number,
  effectiveFrom: IsoDate,
  source: string,
): Thresholds {
  const ratio = indexOn1985Base / BASE_INDEX_1985;
  return {
    effectiveFrom,
    noTenderMax: indexedAmount(BASE_NO_TENDER, ratio),
    zuta4Max: indexedAmount(BASE_ZUTA_4, ratio),
    zuta6Max: indexedAmount(BASE_ZUTA_6, ratio),
    source,
    isOfficial: false,
  };
}

export function thresholdsFor(day: IsoDate, table: readonly Thresholds[]): Thresholds {
  const candidates = table.filter((t) => t.effectiveFrom <= day);
  const latest = candidates.reduce<Thresholds | undefined>(
    (best, t) => (best === undefined || t.effectiveFrom > best.effectiveFrom ? t : best),
    undefined,
  );
  if (latest === undefined) {
    throw new Error(`No thresholds in force on ${day}`);
  }
  return latest;
}

export interface VatBasis {
  readonly valueIncludesVat: boolean;
  /** Conservative default: compare including VAT. The regulations do not say. */
  readonly compareInclVat?: boolean;
  readonly vatRate?: number;
}

export function comparableValue(value: number, basis: VatBasis): number {
  const compareInclVat = basis.compareInclVat ?? true;
  const rate = basis.vatRate ?? DEFAULT_VAT_RATE;
  if (basis.valueIncludesVat === compareInclVat) {
    return value;
  }
  return compareInclVat ? value * (1 + rate) : value / (1 + rate);
}
