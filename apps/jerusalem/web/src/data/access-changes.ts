import { z } from 'zod';

/** A row of access_change_requests (screens-spec 4.1): "החשבון שלי" and the users screen. */
const role = z.enum(['viewer', 'editor', 'unit_manager', 'admin', 'auditor']);
export const changeSchema = z.object({
  id: z.string(),
  kind: z.enum(['add_role', 'remove_role', 'move_unit', 'details']),
  role: role.nullable(),
  unit_id: z.string().nullable(),
  grant_id: z.string().nullable(),
  details: z.record(z.string(), z.string()).nullable(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  decision_note: z.string().nullable(),
});
export type ChangeRequest = z.infer<typeof changeSchema>;
