export const STATUS_RANK = { ok: 0, needs_review: 1, blocked: 2 } as const;

/**
 * ok: every required condition was checked and holds.
 * needs_review: undecided. blocked: not allowed.
 */
export type Status = keyof typeof STATUS_RANK;

export interface Decision {
  route: string;
  regulation: string;
  approver: string;
  status: Status;
  requirements: string[];
  missing: string[];
  warnings: string[];
  /** Amount in ILS that was compared with the thresholds. */
  comparedValue: number | null;
  /** Cumulative increase in percent, for contract increases only. */
  increasePercent: number | null;
  thresholdsSource: string | null;
  /** null: not relevant. false: the check was not run. */
  splittingChecked: boolean | null;
}

export type DecisionResult = Readonly<Decision> & { readonly allowed: boolean };

export const TENDER_COMMITTEE = 'ועדת המכרזים';
export const EXEMPTION_COMMITTEE = 'ועדת הפטור (מנכ"ל, גזבר, יועץ משפטי)';

export function makeDecision(
  route: string,
  regulation: string,
  options: { approver: string; requirements?: readonly string[] },
): Decision {
  return {
    route,
    regulation,
    approver: options.approver,
    status: 'ok',
    requirements: [...(options.requirements ?? [])],
    missing: [],
    warnings: [],
    comparedValue: null,
    increasePercent: null,
    thresholdsSource: null,
    splittingChecked: null,
  };
}

/** Raise the status, never lower it. A blocked result stays blocked. */
export function escalate(decision: Decision, status: Status, warning?: string): void {
  if (STATUS_RANK[status] > STATUS_RANK[decision.status]) {
    decision.status = status;
  }
  if (warning !== undefined) {
    decision.warnings.push(warning);
  }
}

/** allowed is true only when the status is ok. needs_review is not an approval. */
export function toResult(decision: Decision): DecisionResult {
  return { ...decision, allowed: decision.status === 'ok' };
}
