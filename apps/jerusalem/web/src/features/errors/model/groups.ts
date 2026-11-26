// error-details-spec-he.md section 4: the cases grouped by screen, cause, request and kind.
export interface ErrorCase {
  id: number;
  created_at: string;
  kind: string;
  screen: string;
  cause: string;
  request: string | null;
  error_code: string | null;
  boundary: string | null;
  role: string | null;
  device: string | null;
  site_version: string | null;
}

export interface ErrorGroup {
  id: string;
  kind: string;
  screen: string;
  cause: string;
  request: string | null;
  errorCode: string | null;
  boundary: string | null;
  /** Newest first. */
  cases: ErrorCase[];
  roles: number;
  first: string;
  last: string;
  version: string | null;
  urgent: boolean;
}

/** Faults in the system and an unreachable database need someone; they come first. */
const URGENT: ReadonlySet<string> = new Set(['system', 'unavailable']);

export function isUrgent(kind: string): boolean {
  return URGENT.has(kind);
}

type Cases = [ErrorCase, ...ErrorCase[]];

function groupOf(id: string, cases: Cases): ErrorGroup {
  const [latest] = cases;
  return {
    id,
    kind: latest.kind,
    screen: latest.screen,
    cause: latest.cause,
    request: latest.request,
    errorCode: latest.error_code,
    boundary: latest.boundary,
    cases,
    roles: new Set(cases.map((c) => c.role ?? '')).size,
    first: (cases.at(-1) ?? latest).created_at,
    last: latest.created_at,
    version: cases.find((c) => c.site_version)?.site_version ?? null,
    urgent: isUrgent(latest.kind),
  };
}

/** Groups newest-first cases: urgent groups first, then the most frequent, then the latest. */
export function groupCases(cases: readonly ErrorCase[]): ErrorGroup[] {
  const byKey = new Map<string, Cases>();
  for (const item of cases) {
    const key = [item.screen, item.cause, item.request ?? '', item.kind].join('|');
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  return [...byKey]
    .map(([id, list]) => groupOf(id, list))
    .sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        b.cases.length - a.cases.length ||
        b.last.localeCompare(a.last),
    );
}
