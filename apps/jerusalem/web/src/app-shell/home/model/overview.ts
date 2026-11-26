// What the home screen shows (design approved 25.11.2026): the work waiting for this user and
// the state of the registries. The counts come from home_overview and admin_overview.
import { z } from '../../../data/zod.ts';
import { dateLabel } from '../../../lib/dates.ts';
import type { AdminScreen, OverviewKey } from '../../screens.ts';

const count = z.number().int().nonnegative();

export const homeSchema = z.object({
  active_suppliers: count,
  registries: count,
  memberships: count,
  memberships_verified: count,
  suppliers_identified: count,
  my_open_requests: count,
  requests_to_award: count.optional(),
  lapsed: z.array(
    z.object({ registry_id: z.string(), name: z.string(), count, ended_on: z.string() }),
  ),
  kind_suggestions_pending: count.optional(),
  registries_without_unit: count.optional(),
});
export type HomeOverview = z.infer<typeof homeSchema>;
export type AdminCounts = Partial<Record<OverviewKey, number | undefined>>;

export type Tone = 'danger' | 'warning' | 'info';

/** One line of "מחכה לך": what, why it matters and where to handle it. */
export interface WaitingItem {
  id: string;
  tone: Tone;
  badge: string;
  title: string;
  detail: string;
  action: string;
  to: string;
  /** Navigation state for the catalog, to open it already filtered. */
  linkState?: { registry: string; validity: 'expired' };
}

const BADGES: Record<Tone, string> = { danger: 'פג תוקף', warning: 'לאישור', info: 'להשלים' };

function lapsedItems(overview: HomeOverview): WaitingItem[] {
  return overview.lapsed.map((registry) => ({
    id: `lapsed:${registry.registry_id}`,
    tone: 'danger',
    badge: BADGES.danger,
    title: `${registry.count.toLocaleString('he-IL')} ספקים במאגר "${registry.name}"`,
    detail: `הרישום שלהם פג ב-${dateLabel(registry.ended_on)}. עד שיעלה מאגר מעודכן אי אפשר לפנות אליהם דרך המאגר.`,
    action: 'לרשימה',
    to: '/catalog',
    linkState: { registry: registry.registry_id, validity: 'expired' },
  }));
}

function screenItems(screens: readonly AdminScreen[], counts: AdminCounts): WaitingItem[] {
  return screens.flatMap((screen) => {
    const waiting = screen.waiting;
    const n = waiting ? counts[waiting.key] : undefined;
    if (!waiting || !n) return [];
    const text = n === 1 ? waiting.one : `${n.toLocaleString('he-IL')} ${waiting.many}`;
    return [
      {
        id: screen.to,
        tone: 'warning',
        badge: BADGES.warning,
        title: `${screen.title}: ${text}`,
        detail: screen.description,
        action: 'לטיפול',
        to: screen.to,
      },
    ];
  });
}

function adminItems(overview: HomeOverview): WaitingItem[] {
  const items: WaitingItem[] = [];
  const kinds = overview.kind_suggestions_pending ?? 0;
  if (kinds > 0)
    items.push({
      id: 'kinds',
      tone: 'warning',
      badge: BADGES.warning,
      title: `${kinds.toLocaleString('he-IL')} הצעות לסוג ישות`,
      detail: 'חברה, עמותה או עוסק. נדרש כדי לבדוק את הספק ברשם הנכון.',
      action: 'לבדיקה',
      to: '/identifiers',
    });
  const orphans = overview.registries_without_unit ?? 0;
  if (orphans > 0)
    items.push({
      id: 'orphans',
      tone: 'info',
      badge: BADGES.info,
      title: `${orphans.toLocaleString('he-IL')} מאגרים בלי יחידה אחראית`,
      detail: 'בלי יחידה אחראית אין מי שיעדכן את תוקף המאגר.',
      action: 'לבקרת הטעינה',
      to: '/load-control',
    });
  return items;
}

/** Requests whose offers are all open, waiting for the unit to choose (stage C, 25.11). */
function awardItems(overview: HomeOverview): WaitingItem[] {
  const n = overview.requests_to_award ?? 0;
  if (n === 0) return [];
  return [
    {
      id: 'award',
      tone: 'warning',
      badge: 'לבחירה',
      title:
        n === 1
          ? 'בקשה אחת מחכה לבחירת זוכה'
          : `${n.toLocaleString('he-IL')} בקשות מחכות לבחירת זוכה`,
      detail: 'המועד להגשת ההצעות עבר וההצעות נפתחו.',
      action: 'לבקשות',
      to: '/engagement',
    },
  ];
}

/** Lapsed registrations first, then approvals, then gaps to fill. */
export function waitingItems(
  overview: HomeOverview | null,
  screens: readonly AdminScreen[],
  counts: AdminCounts,
): WaitingItem[] {
  const fromOverview = overview ? [...lapsedItems(overview), ...awardItems(overview)] : [];
  const later = overview ? adminItems(overview) : [];
  const order: Record<Tone, number> = { danger: 0, warning: 1, info: 2 };
  return [...fromOverview, ...screenItems(screens, counts), ...later].sort(
    (a, b) => order[a.tone] - order[b.tone],
  );
}

/** The line under the greeting: how much waits and how much of it is urgent. */
export function waitingLead(items: readonly WaitingItem[]): string {
  if (items.length === 0) return 'אין כרגע עבודה שמחכה לך.';
  const urgent = items.filter((item) => item.tone === 'danger').length;
  if (items.length === 1) return urgent ? 'יש נושא אחד פתוח, והוא דחוף.' : 'יש נושא אחד פתוח.';
  const open = `יש ${items.length.toLocaleString('he-IL')} נושאים פתוחים`;
  if (urgent === 0) return `${open}. שום דבר לא דחוף.`;
  return `${open}, ${urgent === 1 ? 'אחד מהם דחוף' : `${urgent.toLocaleString('he-IL')} מהם דחופים`}.`;
}
