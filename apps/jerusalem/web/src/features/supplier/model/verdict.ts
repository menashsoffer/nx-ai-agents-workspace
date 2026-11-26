// The band at the top of the supplier screen (design approved 25.11.2026): may the
// municipality contract with this supplier through a registry, until when, and what was and
// was not checked. Never "clean": a check that did not run is listed as not checked.
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { dateLabel } from '../../../lib/dates.ts';
import { registrarRows } from './registrar.ts';

export type VerdictKind = 'allowed' | 'blocked' | 'check';
export type RowState = 'ok' | 'warn' | 'bad' | 'none';
export interface VerdictRow {
  state: RowState;
  title: string;
  detail: string;
}
export interface Verdict {
  kind: VerdictKind;
  label: string;
  summary: string;
  rows: VerdictRow[];
}

const LABELS: Record<VerdictKind, string> = { allowed: 'מותר', blocked: 'לא מותר', check: 'לבדוק' };
const ID_SCHEMES = new Set(['company', 'nonprofit', 'vat_dealer']);

interface Registration {
  registry: string;
  from: string | null;
  until: string | null;
  verified: boolean;
}

/** Each listing in an open registry, its dates inherited from the registry version if missing. */
function registrations(data: SupplierDetail): Registration[] {
  return data.memberships.flatMap((m) => {
    const version = data.versions.find((v) => v.id === m.registry_version_id);
    const registry = data.registries.find((r) => r.id === version?.registry_id);
    if (!version || !registry || registry.status === 'closed' || m.review_status === 'rejected')
      return [];
    return [
      {
        registry: registry.name,
        from: m.registered_from ?? version.valid_from,
        until: m.registered_until ?? version.valid_until,
        verified: m.review_status === 'verified',
      },
    ];
  });
}

function latest(items: Registration[]): Registration | undefined {
  return [...items].sort((a, b) => (b.until ?? '').localeCompare(a.until ?? ''))[0];
}

function registrationRow(items: Registration[], today: string): VerdictRow {
  const current = items.filter((r) => r.until && r.until >= today && (!r.from || r.from <= today));
  const best = latest(current);
  if (best?.until)
    return {
      state: 'ok',
      title: 'רשום במאגר בתוקף',
      detail: `${best.registry}, עד ${dateLabel(best.until)}`,
    };
  const undated = items.find((r) => !r.until);
  if (undated)
    return {
      state: 'warn',
      title: 'לא ידוע עד מתי הרישום בתוקף',
      detail: `${undated.registry}: אין תאריך תוקף לספק או למאגר`,
    };
  const ended = latest(items);
  if (ended?.until && ended.until < today)
    return {
      state: 'bad',
      title: 'הרישום במאגר פג',
      detail: `${ended.registry}, פג ב-${dateLabel(ended.until)}`,
    };
  if (ended?.from)
    return {
      state: 'warn',
      title: 'הרישום עוד לא התחיל',
      detail: `${ended.registry}, מ-${dateLabel(ended.from)}`,
    };
  return { state: 'bad', title: 'לא רשום באף מאגר פתוח', detail: 'אין רישום שאפשר לפנות דרכו' };
}

function reviewRow(items: Registration[]): VerdictRow {
  return items.some((r) => r.verified)
    ? { state: 'ok', title: 'השיוך למאגר נבדק', detail: 'נבדק מול מסמך המאגר' }
    : {
        state: 'warn',
        title: 'השיוך למאגר עוד לא נבדק',
        detail: 'צריך לוודא מול מסמך המאגר שהספק מופיע בו',
      };
}

function identifierRow(data: SupplierDetail): VerdictRow {
  const ids = data.identifiers.filter(
    (i) => ID_SCHEMES.has(i.scheme) && i.review_status !== 'rejected',
  );
  if (ids.some((i) => i.review_status === 'verified'))
    return { state: 'ok', title: 'מספר מזהה אושר', detail: 'ח.פ., מספר עמותה או עוסק מורשה' };
  if (ids.length)
    return {
      state: 'warn',
      title: 'מספר מזהה עוד לא אושר',
      detail: 'נמצא מספר, וצריך אישור של אדם',
    };
  return { state: 'warn', title: 'אין מספר מזהה', detail: 'בלי מספר אי אפשר לבדוק את הספק ברשם' };
}

function summaryOf(kind: VerdictKind, rows: VerdictRow[], until: string | null): string {
  if (kind === 'allowed') return until ? `עד ${dateLabel(until)}.` : '';
  const first = rows.find((r) => r.state === (kind === 'blocked' ? 'bad' : 'warn'));
  return first ? `${first.title}.` : '';
}

export function verdict(data: SupplierDetail, today: string): Verdict {
  const items = registrations(data);
  const registration = registrationRow(items, today);
  const rows = [registration, reviewRow(items), identifierRow(data), ...registrarRows(data, today)];
  if (data.supplier.status === 'inactive')
    rows.unshift({
      state: 'bad',
      title: 'הספק סומן כלא פעיל',
      detail: data.supplier.status_reason ?? 'אין לפנות אליו בבקשות חדשות',
    });
  const kind: VerdictKind = rows.some((r) => r.state === 'bad')
    ? 'blocked'
    : rows.some((r) => r.state === 'warn')
      ? 'check'
      : 'allowed';
  const until = latest(items.filter((r) => r.until && r.until >= today))?.until ?? null;
  return { kind, label: LABELS[kind], summary: summaryOf(kind, rows, until), rows };
}
