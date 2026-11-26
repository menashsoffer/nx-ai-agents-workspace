import { useEffect } from 'react';
import { reportBoundaryError } from '../lib/telemetry.ts';
import { describeError } from '../data/errors.ts';
import type { ErrorReport } from '../lib/vitals-model.ts';
/** Reporting is an external side effect, never part of rendering the error screen. */
export function useErrorReport(error: unknown, boundary: ErrorReport['boundary']): void {
  useEffect(() => {
    reportBoundaryError(error, boundary, describeError(error).kind);
  }, [error, boundary]);
}
