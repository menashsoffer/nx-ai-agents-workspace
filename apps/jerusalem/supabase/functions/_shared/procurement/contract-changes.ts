import { requireAmount } from './amounts.ts';
import { daysBetween, parseIsoDate, type IsoDate } from './dates.ts';
import { escalate, makeDecision, toResult, type DecisionResult } from './decision.ts';

/** The temporary provision in 3(20) applies from 21.4.2026 until 30 days after the special
 * state ends. */
export const REG_3_20_START: IsoDate = '2026-04-21';
const REG_3_20_GRACE_DAYS = 30;
const REG_3_20_MAX_MONTHS = 6;
const NEAR_CAP_SHARE = 0.8;

export interface IncreaseRequest {
  /**
   * existing_item: 3(7)(א), cap 50%.
   * added_items: 3(7)(ב), cap 25%, or 50% after a council decision.
   */
  readonly kind: 'existing_item' | 'added_items';
  /** existing_item: spending on that item. added_items: all spending under the contract. */
  readonly baseAmount: number;
  readonly previousIncreases: number;
  readonly newIncrease: number;
  readonly councilDecidedTenderUseless?: boolean;
}

/**
 * Contract increase under 3(7). Increases count cumulatively. This is the conservative reading:
 * the regulation does not allow several small increases to bypass the cap.
 */
export function checkIncrease(request: IncreaseRequest): DecisionResult {
  const base = requireAmount(request.baseAmount, 'baseAmount', true);
  const cumulative =
    requireAmount(request.previousIncreases, 'previousIncreases') +
    requireAmount(request.newIncrease, 'newIncrease');
  const council = request.kind === 'added_items' && request.councilDecidedTenderUseless === true;
  const cap = request.kind === 'existing_item' || council ? 0.5 : 0.25;
  const regulation = request.kind === 'existing_item' ? '3(7)(א)' : '3(7)(ב)';
  const share = cumulative / base;

  const decision = makeDecision(`increase_${request.kind}`, regulation, {
    approver: 'ועדת הרחבות והגדלות לפי נוהל העירייה',
    requirements: [
      'תיעוד שווי החוזה המקורי ושל כל הגדלה קודמת',
      'החלטה מנומקת לפני ביצוע ההגדלה',
      ...(council ? ['החלטת מועצה שעריכת מכרז לא תביא תועלת'] : []),
    ],
  });
  decision.increasePercent = Math.round(share * 10_000) / 100;
  const pct = `${(share * 100).toFixed(1)}%`;
  const capPct = `${String(cap * 100)}%`;
  if (share > cap) {
    escalate(
      decision,
      'blocked',
      `הגדלה מצטברת של ${pct} עולה על התקרה של ${capPct} לפי תקנה ${regulation}. נדרש הליך תחרותי חדש.`,
    );
  } else if (share > cap * NEAR_CAP_SHARE) {
    decision.warnings.push(`הגדלה מצטברת של ${pct} קרובה לתקרה של ${capPct}.`);
  }
  return toResult(decision);
}

export interface Continuation {
  readonly value: number;
  readonly months: number;
}

export interface ContinuationRequest {
  readonly on: IsoDate;
  readonly first: Continuation;
  /** Earlier continuations count cumulatively (3(20)(ג)). */
  readonly previous: readonly Continuation[];
  readonly next: Continuation;
  readonly committeeConvinced: boolean;
  /** End of the declared special state, when known. */
  readonly specialStateEnd?: IsoDate;
  /** Confirmation that the declaration is still in force on the check date. */
  readonly specialStateActiveConfirmed?: boolean;
}

/** Continuation contract under the temporary provision in 3(20). */
export function checkContinuation320(request: ContinuationRequest): DecisionResult {
  const decision = makeDecision('continuation_3_20', '3(20)', {
    approver: 'ועדה: מנכ"ל (יו"ר), גזבר, יועץ משפטי',
    requirements: [
      'החלטה מנומקת של הוועדה',
      'פרסום ההחלטה באתר העירייה בתוך 5 ימי עבודה (3(20)(ד))',
      'תנאים זהים או מיטיבים עם העירייה',
    ],
  });
  const all = [...request.previous, request.next];
  const totalValue = all.reduce((sum, c) => sum + requireAmount(c.value, 'value'), 0);
  const totalMonths = all.reduce((sum, c) => sum + requireAmount(c.months, 'months'), 0);
  const end = request.specialStateEnd;

  const on = parseIsoDate(request.on);
  if (on < REG_3_20_START) {
    escalate(decision, 'blocked', 'הוראת השעה חלה רק מ-21.4.2026.');
  }
  if (end !== undefined && daysBetween(end, on) > REG_3_20_GRACE_DAYS) {
    escalate(decision, 'blocked', 'הוראת השעה פקעה: עברו יותר מ-30 יום מתום המצב המיוחד בעורף.');
  }
  if (end === undefined && request.specialStateActiveConfirmed !== true) {
    decision.missing.push('מועד תום ההכרזה על מצב מיוחד בעורף, או אישור שההכרזה עדיין בתוקף');
    escalate(
      decision,
      'needs_review',
      'תוקף הוראת השעה תלוי במועד תום המצב המיוחד בעורף, שלא הוזן. התוצאה לא הוכרעה.',
    );
  }
  if (totalMonths > REG_3_20_MAX_MONTHS) {
    escalate(
      decision,
      'blocked',
      `משך מצטבר של ${String(totalMonths)} חודשים עולה על 6 (3(20)(ב)).`,
    );
  }
  if (totalValue > requireAmount(request.first.value, 'first.value')) {
    escalate(
      decision,
      'blocked',
      'שווי מצטבר של התקשרויות ההמשך עולה על שווי ההתקשרות הראשונה (3(20)(א)).',
    );
  }
  if (!request.committeeConvinced) {
    decision.missing.push('קביעת הוועדה שמגבלות המצב הביטחוני מונעות עריכת מכרז');
    escalate(decision, 'needs_review');
  }
  return toResult(decision);
}
