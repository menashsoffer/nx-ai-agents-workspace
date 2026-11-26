import {
  checkNewContract,
  comparableValue,
  parseIsoDate,
  type DecisionResult,
  type IsoDate,
  type Thresholds,
} from '../_shared/procurement/index.ts';

// Turns what public.route_check_input returned into an engine call. All values
// come from the database, never from the browser.

interface Amount {
  readonly estimated_value: number | string;
  readonly value_includes_vat: boolean;
}

interface Request extends Amount {
  readonly requested_exemption: string | null;
  readonly facts: Readonly<Record<string, unknown>>;
}

interface ThresholdRow {
  readonly id: string;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly no_tender_max: number | string;
  readonly zuta4_max: number | string;
  readonly zuta6_max: number | string;
  readonly source: string;
  readonly is_official: boolean;
}

export interface CheckInput {
  readonly user_id: string;
  readonly request: Request;
  readonly thresholds: ThresholdRow | null;
  readonly related: readonly Amount[] | null;
}

export interface Checked {
  readonly result: DecisionResult;
  readonly thresholdId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A saved request by id, or an unsaved draft that the database validates. */
export type Target =
  | { readonly requestId: string; readonly on: IsoDate }
  | { readonly draft: Readonly<Record<string, unknown>>; readonly on: IsoDate };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTarget(body: Record<string, unknown>, today: IsoDate): Target | null {
  const { request_id: id, draft } = body;
  const on = body.on ?? today;
  if (typeof on !== 'string') return null;
  const valid = typeof id === 'string' ? UUID.test(id) && draft === undefined : isRecord(draft);
  if (!valid) return null;
  try {
    const date = parseIsoDate(on);
    return typeof id === 'string'
      ? { requestId: id, on: date }
      : { draft: draft as never, on: date };
  } catch {
    return null;
  }
}

function toThresholds(row: ThresholdRow): Thresholds {
  return {
    effectiveFrom: row.valid_from,
    noTenderMax: Number(row.no_tender_max),
    zuta4Max: Number(row.zuta4_max),
    zuta6Max: Number(row.zuta6_max),
    source: row.source,
    isOfficial: row.is_official,
    ...(row.valid_until === null ? {} : { validUntil: row.valid_until }),
  };
}

function trueFacts(facts: Readonly<Record<string, unknown>>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, value === true]));
}

/** Runs the engine, or returns null when no thresholds were in force on the date. */
export function runEngine(input: CheckInput, on: IsoDate): Checked | null {
  if (input.thresholds === null) return null;
  const { request } = input;
  const result = checkNewContract(
    {
      value: Number(request.estimated_value),
      valueIncludesVat: request.value_includes_vat,
      on,
      ...(request.requested_exemption === null ? {} : { exemption: request.requested_exemption }),
      facts: trueFacts(request.facts),
      ...(input.related === null
        ? {}
        : {
            relatedValues: input.related.map((r) =>
              comparableValue(Number(r.estimated_value), {
                valueIncludesVat: r.value_includes_vat,
              }),
            ),
          }),
    },
    [toThresholds(input.thresholds)],
  );
  return { result, thresholdId: input.thresholds.id };
}
