// The chips under the home search (Menash, 26.11.2026). Until the site counts what people search
// for, they show the registries that hold the most active suppliers.
import type { Supplier } from '../../../catalog-model.ts';

export interface PopularRegistry {
  id: string;
  name: string;
  count: number;
}

function countRegistries(suppliers: readonly Supplier[]): Map<string, PopularRegistry> {
  const counts = new Map<string, PopularRegistry>();
  for (const supplier of suppliers) {
    if (supplier.inactive) continue;
    const open = supplier.memberships.filter((m) => !m.registryClosed);
    for (const id of new Set(open.map((m) => m.registryId))) {
      const name = open.find((m) => m.registryId === id)?.registry ?? '';
      const row = counts.get(id) ?? { id, name, count: 0 };
      row.count += 1;
      counts.set(id, row);
    }
  }
  return counts;
}

/** The registries with the most active suppliers, most first, then by name. */
export function busiestRegistries(suppliers: readonly Supplier[], limit = 3): PopularRegistry[] {
  return [...countRegistries(suppliers).values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'he'))
    .slice(0, limit);
}

/** "בוקר טוב" and so on, by the hour in Jerusalem. */
export function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: 'Asia/Jerusalem',
    }).format(now),
  );
  if (hour >= 5 && hour < 12) return 'בוקר טוב';
  if (hour >= 12 && hour < 17) return 'צהריים טובים';
  if (hour >= 17 && hour < 21) return 'ערב טוב';
  return 'לילה טוב';
}
