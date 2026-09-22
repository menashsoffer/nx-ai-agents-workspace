// Validates tools/security/exceptions.json (docs/security.md, section 6).

export const CONTROLS = [
  'D1',
  'D2',
  'D2-T',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'D8',
  'W1',
  'W2',
  'W3',
  'W4',
  'W5',
  'W6',
  'W7',
  'W8',
  'S1',
  'S2',
  'S3',
  'S4',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'P1',
  'P2',
];
export const MAX_EXCEPTION_DAYS = 90;
const OWNER = /^@[A-Za-z0-9-]+(\/[A-Za-z0-9-]+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

const parseDate = (value) =>
  DATE.test(value ?? '') ? Date.parse(`${value}T00:00:00Z`) : NaN;

/**
 * @returns {string[]} problems; empty when the file is valid
 */
export function validateExceptions(exceptions, today = new Date()) {
  if (!Array.isArray(exceptions))
    return ['exceptions.json must be a JSON array.'];
  const now = Date.parse(today.toISOString().slice(0, 10) + 'T00:00:00Z');
  const problems = [];

  exceptions.forEach((entry, index) => {
    const at = `exceptions[${index}]${entry?.target ? ` (${entry.target})` : ''}`;
    if (!CONTROLS.includes(entry?.control))
      problems.push(`${at}: unknown control "${entry?.control}".`);
    if (!entry?.target) problems.push(`${at}: missing target.`);
    if (typeof entry?.reason !== 'string' || entry.reason.trim().length < 20) {
      problems.push(`${at}: reason must be at least 20 characters.`);
    }
    if (!OWNER.test(entry?.owner ?? '')) {
      problems.push(
        `${at}: owner must be a GitHub @user or @org/team, got "${entry?.owner ?? ''}".`,
      );
    }
    const created = parseDate(entry?.created);
    const expires = parseDate(entry?.expires);
    if (Number.isNaN(created))
      problems.push(`${at}: created must be YYYY-MM-DD.`);
    else if (created > now) problems.push(`${at}: created is in the future.`);
    if (Number.isNaN(expires))
      problems.push(`${at}: expires must be YYYY-MM-DD.`);
    else {
      if (
        !Number.isNaN(created) &&
        expires - created > MAX_EXCEPTION_DAYS * DAY
      ) {
        problems.push(
          `${at}: expires more than ${MAX_EXCEPTION_DAYS} days after created.`,
        );
      }
      if (expires < now) problems.push(`${at}: expired on ${entry.expires}.`);
    }
  });
  return problems;
}

/** Targets excepted for the given controls (only call on a valid file). */
export function exceptedTargets(exceptions, controls) {
  return new Set(
    exceptions.filter((e) => controls.includes(e.control)).map((e) => e.target),
  );
}
