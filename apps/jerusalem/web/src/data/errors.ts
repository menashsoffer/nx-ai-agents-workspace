// One way to turn any failure into the words the site shows (error-handling-spec-he.md).
import { DataError, unanswered } from './client.ts';
import { reportBoundaryError } from '../lib/telemetry.ts';
import { FAILURES, failureSentence, type FailureKind } from '../lib/errors/failure.ts';

export interface Failure {
  kind: FailureKind;
  /** Cause and next step, ready to show. */
  text: string;
  retry: boolean;
}

/**
 * Anything else that reaches a screen (a response in an unexpected shape, a bug) is a fault in
 * the system: the person can do nothing about it, so the text says so instead of "try again".
 */
export function describeError(error: unknown): Failure {
  const known = error instanceof DataError ? error : networkFailure(error);
  if (known) return { kind: known.kind, text: known.message, retry: known.retryable };
  return { kind: 'system', text: failureSentence(FAILURES.system), retry: false };
}

/** A fetch outside DataClient that got no answer: the browsers' own wording for it. */
const NETWORK_MESSAGES = /failed to fetch|networkerror|load failed|network request failed/i;

function networkFailure(error: unknown): DataError | null {
  const timeout = error instanceof DOMException && error.name === 'TimeoutError';
  const network = error instanceof TypeError && NETWORK_MESSAGES.test(error.message);
  return timeout || network ? unanswered(error) : null;
}

/** The text to show beside a button or form; the error is counted once (spec section 8). */
export function errorText(error: unknown): string {
  const failure = describeError(error);
  reportBoundaryError(error, 'action', failure.kind);
  return failure.text;
}
