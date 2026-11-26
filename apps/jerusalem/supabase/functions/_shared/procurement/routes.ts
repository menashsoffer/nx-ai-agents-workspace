import type { Thresholds } from './amounts.ts';
import { makeDecision, TENDER_COMMITTEE, type Decision } from './decision.ts';

const ESTIMATE = 'אומדן (תקנה 11)';
const ZUTA_DELIVERY = [
  'פנייה בדואר רשום עם אישור מסירה או במסירה ידנית (תקנה 8(ד))',
  'תיעוד הספקים שפנו אליהם לדיווח השנתי (תקנה 8(ג))',
];

function zutaRequirements(invitations: number): string[] {
  return [
    ESTIMATE,
    `פנייה ל-${String(invitations)} ספקים לפחות מרשימת הספקים של תקנה 8(ב)`,
    ...ZUTA_DELIVERY,
  ];
}

/** The route the value alone requires: 3(3), zuta tender under 8(ד), or a public tender. */
export function routeByValue(value: number, t: Thresholds): Decision {
  if (value <= t.noTenderMax) {
    return makeDecision('no_tender_low_value', '3(3)', {
      approver: 'הגורם המוסמך לפי נוהל העירייה',
      requirements: [
        'תיעוד השווי ואופן חישובו',
        'השוואת הצעות לפי נוהל פנימי (התקנות אינן מחייבות)',
      ],
    });
  }
  if (value <= t.zuta4Max) {
    return makeDecision('zuta_4', '8(ד)(1)', {
      approver: TENDER_COMMITTEE,
      requirements: zutaRequirements(4),
    });
  }
  if (value <= t.zuta6Max) {
    return makeDecision('zuta_6', '8(ד)(2)', {
      approver: TENDER_COMMITTEE,
      requirements: zutaRequirements(6),
    });
  }
  return makeDecision('public_tender', 'סעיף 197 לפקודת העיריות ותקנה 3', {
    approver: TENDER_COMMITTEE,
    requirements: [ESTIMATE, 'פרסום מכרז פומבי', 'רישום בפנקס המכרזים (תקנה 7)'],
  });
}

/**
 * Regulation 5: contracts for the same goods or one whole work, made at one time, count as one.
 * Which requests are related is a municipal policy decision, not part of the regulation.
 * Returns a warning when adding the related requests changes the route, otherwise null.
 */
export function checkSplitting(
  newValue: number,
  relatedValues: readonly number[],
  t: Thresholds,
): string | null {
  if (relatedValues.length === 0) {
    return null;
  }
  const alone = routeByValue(newValue, t).route;
  const total = relatedValues.reduce((sum, v) => sum + v, newValue);
  const combined = routeByValue(total, t).route;
  if (alone === combined) {
    return null;
  }
  return (
    `חשש לפיצול (תקנה 5): לבדה הבקשה במסלול ${alone}, ` +
    `אך יחד עם ${String(relatedValues.length)} בקשות קשורות היא במסלול ${combined}.`
  );
}
