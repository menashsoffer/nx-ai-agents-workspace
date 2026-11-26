import { errorCode, type ErrorReport, type TelemetryEvent } from './vitals-model.ts';
import type { FailureKind } from './errors/failure.ts';
/** Receives each event, and for an error the error object, which it never sends as is. */
export type TelemetryReporter = (event: TelemetryEvent, error?: unknown) => void;
/** Errors before a reporter is set wait here (error-details-spec-he.md section 6). */
const waiting: Parameters<TelemetryReporter>[] = [];
let report: TelemetryReporter = (...entry) => waiting.push(entry);
const objects = new WeakSet<object>();
const primitives = new Set<string>();
/** Sets the reporter and hands it what waited for one. */
export function setTelemetryReporter(send: TelemetryReporter): void {
  report = send;
  for (const entry of waiting.splice(0)) send(...entry);
}
/** Names the database function a failure came from; the first name wins. */
export function tagRequest(error: unknown, request: string): unknown {
  if (error instanceof Object && !('request' in error)) Object.assign(error, { request });
  return error;
}

/** Counts an error once per error object: its kind, never its text. */
export function reportBoundaryError(
  error: unknown,
  boundary: ErrorReport['boundary'],
  kind?: FailureKind,
): void {
  if (typeof error === 'object' && error !== null) {
    if (objects.has(error)) return;
    objects.add(error);
  } else {
    if (primitives.has(boundary)) return;
    primitives.add(boundary);
  }
  try {
    const event: ErrorReport = { name: 'error', error_code: errorCode(error), boundary };
    if (kind) event.kind = kind;
    report(event, error);
  } catch {
    /* Monitoring never breaks recovery. */
  }
}
