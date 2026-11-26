// What each shown error was, in fixed values only (error-details-spec-he.md section 3).
// Loaded with the monitoring chunk, after the first screen. The error's text is read only to
// recognise a file that failed to load, and is never sent.
import type { FailureKind } from './errors/failure.ts';
import type { ErrorCause, ErrorReport } from './vitals-model.ts';

interface ErrorShape {
  status?: unknown;
  kind?: unknown;
  superseded?: unknown;
  request?: unknown;
  name?: unknown;
}
export interface ErrorContext {
  screen: string;
  device: 'desktop' | 'mobile';
  version: string;
}

/** Browsers' wording when a part of the site cannot be loaded, usually after a new release. */
const STALE_FILES =
  /dynamically imported module|importing a module script failed|error loading dynamically/i;
/** Kinds for a request that got no answer, or whose answer was lost. */
const UNANSWERED: ReadonlySet<unknown> = new Set([
  'offline',
  'timeout',
  'unavailable',
  'unconfirmed',
]);
const REQUEST = /^[a-z][a-z0-9_]{0,62}$/;
const VERSION = /^[0-9a-f]{7}$/;

function staleFiles(error: object): boolean {
  return error instanceof TypeError && STALE_FILES.test(error.message);
}

type Rule = readonly [ErrorCause, (e: ErrorShape, kind: unknown, error: object) => boolean];
/** The first rule that matches names the cause; the order matters. */
const RULES: readonly Rule[] = [
  ['superseded', (e) => e.superseded === true],
  ['stale_files', (_e, _kind, error) => staleFiles(error)],
  ['rule', (_e, kind) => kind === 'rule' || kind === 'reason'],
  ['http', (e) => typeof e.status === 'number' && e.status > 0],
  ['network', (_e, kind) => UNANSWERED.has(kind)],
  ['bad_answer', (e, kind) => e.name === 'ZodError' || kind === 'system'],
  ['render', (_e, _kind, error) => error instanceof Error],
];

export function causeOf(error: unknown, shown?: FailureKind): ErrorCause {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const e: ErrorShape = error;
  const kind = shown ?? e.kind;
  return RULES.find(([, matches]) => matches(e, kind, error))?.[0] ?? 'unknown';
}

function requestOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { request }: ErrorShape = error;
  return typeof request === 'string' && REQUEST.test(request) ? request : undefined;
}

/** The report with its screen, cause, request, device and site version. */
export function withDetails(event: ErrorReport, error: unknown, context: ErrorContext) {
  const detailed: ErrorReport = {
    ...event,
    screen: context.screen,
    cause: causeOf(error, event.kind),
    device: context.device,
  };
  const request = requestOf(error);
  if (request) detailed.request = request;
  if (VERSION.test(context.version)) detailed.site_version = context.version;
  return detailed;
}

type ViteEnv = Partial<Record<'VITE_SITE_VERSION', string>>;
/** The release the browser runs: the first 7 characters of its commit, set at build time. */
export const SITE_VERSION =
  (import.meta as ImportMeta & { env?: ViteEnv }).env?.VITE_SITE_VERSION ?? '';
