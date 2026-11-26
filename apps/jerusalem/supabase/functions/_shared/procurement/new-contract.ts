import {
  comparableValue,
  requireAmount,
  thresholdsFor,
  thresholdValidUntil,
  type Thresholds,
  type VatBasis,
} from './amounts.ts';
import { parseIsoDate, type IsoDate } from './dates.ts';
import {
  escalate,
  makeDecision,
  toResult,
  type Decision,
  type DecisionResult,
} from './decision.ts';
import { EXEMPTIONS } from './exemptions.ts';
import { checkSplitting, routeByValue } from './routes.ts';

export interface NewContractRequest extends VatBasis {
  readonly value: number;
  readonly on: IsoDate;
  /** Exemption basis requested, for example "3(8)". */
  readonly exemption?: string;
  /** Facts confirmed for the exemption. Only true counts. */
  readonly facts?: Readonly<Record<string, boolean>>;
  /**
   * Values of related requests for the splitting check (regulation 5), already on the same VAT
   * basis as the comparison. Omitted means the check was not run, and the result says so.
   */
  readonly relatedValues?: readonly number[];
}

function applyExemption(
  byValue: Decision,
  exemption: string,
  facts: Readonly<Record<string, boolean>>,
): Decision {
  const rule = EXEMPTIONS[exemption];
  if (rule === undefined) {
    byValue.warnings.push(`בסיס הפטור ${exemption} אינו ממודל במנוע. נבדק לפי שווי בלבד.`);
    return byValue;
  }
  const missing = Object.entries(rule.requiredFacts)
    .filter(([key]) => facts[key] !== true)
    .map(([, text]) => text);
  if (missing.length > 0) {
    byValue.missing = missing;
    byValue.warnings.push(
      `לא ניתן להחיל פטור לפי תקנה ${rule.regulation} בלי הנתונים החסרים. המסלול נקבע לפי שווי.`,
    );
    return byValue;
  }
  const code = 'exemption_' + rule.regulation.replace('(', '_').replace(')', '');
  const decision = makeDecision(code, rule.regulation, {
    approver: rule.approver,
    requirements: rule.requirements,
  });
  if (rule.unmodeled.length > 0) {
    decision.missing = [...rule.unmodeled];
    escalate(
      decision,
      'needs_review',
      `הפטור לפי תקנה ${rule.regulation} אפשרי רק אחרי בדיקה ידנית של תנאים שהמנוע אינו בודק.`,
    );
  }
  if (exemption === '3(6)') {
    decision.warnings.push('פטור דחיפות אינו מכשיר המשך התקשרות אחרי שהדחיפות חלפה.');
  }
  return decision;
}

function checkThresholdFreshness(decision: Decision, t: Thresholds, on: IsoDate): void {
  if (!t.isOfficial) {
    decision.warnings.push('הספים מחושבים ואינם פרסום רשמי של משרד הפנים. יש לאמת לפני הסתמכות.');
  }
  const until = thresholdValidUntil(t);
  if (on > until) {
    escalate(
      decision,
      'needs_review',
      `אין בטבלה סף מעודכן ליום ${on}. הסף האחרון תקף עד ${until}. ` +
        'יש לעדכן את טבלת הספים לפני הסתמכות.',
    );
  }
}

/** The legal route for a new contract, by value and by the requested exemption if any. */
export function checkNewContract(
  request: NewContractRequest,
  table: readonly Thresholds[],
): DecisionResult {
  const value = requireAmount(request.value, 'value');
  const on = parseIsoDate(request.on);
  const t = thresholdsFor(on, table);
  const compared = comparableValue(value, request);
  const byValue = routeByValue(compared, t);
  const decision =
    request.exemption === undefined
      ? byValue
      : applyExemption(byValue, request.exemption, request.facts ?? {});
  decision.comparedValue = compared;
  decision.thresholdsSource = t.source;
  checkThresholdFreshness(decision, t, on);

  if (request.relatedValues === undefined) {
    decision.splittingChecked = false;
    decision.warnings.push('בדיקת פיצול (תקנה 5) לא בוצעה: לא נמסרו בקשות קשורות.');
  } else {
    decision.splittingChecked = true;
    const related = request.relatedValues.map((v) => requireAmount(v, 'relatedValues'));
    const split = checkSplitting(compared, related, t);
    if (split !== null) {
      escalate(decision, 'needs_review', split);
    }
  }
  return toResult(decision);
}
