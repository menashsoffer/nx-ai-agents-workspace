// What a candidate supplier already has, so the review shows existing and new values side by
// side before the admin approves (spec section 8).
import { rows } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';

const supplierSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  entity_kind: z.string(),
  website: z.string().nullable(),
});
const contactSchema = z.object({
  supplier_id: z.string(),
  kind: z.string(),
  value: z.string(),
  status: z.string(),
});

export interface Existing {
  name: string;
  entity_kind: string;
  website: string | null;
  contacts: { kind: string; value: string }[];
}

const CHUNK = 80;

/** Existing values of the given suppliers, read in chunks to keep each URL short. */
export async function loadExisting(ids: readonly string[]): Promise<Map<string, Existing>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, Existing>();
  for (let at = 0; at < unique.length; at += CHUNK) {
    const list = `in.(${unique.slice(at, at + CHUNK).join(',')})`;
    const [suppliers, contacts] = await Promise.all([
      rows('suppliers', { id: list }, z.array(supplierSchema)),
      rows('supplier_contacts', { supplier_id: list }, z.array(contactSchema)),
    ]);
    for (const s of suppliers) {
      const own = contacts.filter((c) => c.supplier_id === s.id && c.status === 'current');
      result.set(s.id, {
        name: s.display_name,
        entity_kind: s.entity_kind,
        website: s.website,
        contacts: own.map(({ kind, value }) => ({ kind, value })),
      });
    }
  }
  return result;
}
