// Short Hebrew names for the failure kinds of error-handling-spec-he.md section 3.
const KINDS: Record<string, string> = {
  offline: 'אין חיבור לאינטרנט',
  timeout: 'השרת לא ענה בזמן',
  unavailable: 'מסד הנתונים לא זמין',
  system: 'תקלה במערכת',
  session: 'פג תוקף ההתחברות',
  forbidden: 'אין הרשאה',
  rule: 'ערך לא תקין',
  reason: 'סירוב עסקי',
  gone: 'כבר טופל או נמחק',
  duplicate: 'כבר קיים',
  rate_limit: 'יותר מדי פעולות',
  unconfirmed: 'לא ברור אם נשמר',
};
export function kindLabel(kind: string): string {
  return KINDS[kind] ?? kind;
}
