import { requireRoles, rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';

const count = z.number().int().nonnegative();
const addressesSchema = z.object({
  counts: z.object({ found: count, approximate: count, not_found: count, waiting: count }),
  items: z.array(
    z.object({
      contact_id: z.string(),
      supplier_id: z.string(),
      supplier_name: z.string(),
      value: z.string(),
      result: z.enum(['approximate', 'not_found']),
      map_label: z.string().nullable(),
      checked_at: z.string(),
    }),
  ),
});
export type AddressesToCheck = z.infer<typeof addressesSchema>;

/** Admin only: the database refuses anyone else (public.addresses_to_check). */
export async function loadAddresses(): Promise<AddressesToCheck> {
  await requireRoles(['admin']);
  return rpc('addresses_to_check', {}, addressesSchema);
}
