import { z } from 'zod';

/**
 * A change to a supplier and the database's checks of it
 * (documentation/supplier-edit-checks-spec-he.md, sections 4 and 6).
 */
export type ChangeKind = 'rename' | 'entity_kind' | 'contact';
export interface SupplierChange {
  supplier_id: string;
  kind: ChangeKind;
  /** An empty value on a contact change with a contact_id deletes that contact. */
  value: string;
  contact_kind?: string;
  contact_id?: string;
  reason?: string;
}

export const outcomeSchema = z.enum(['green', 'yellow', 'red']);
export type Outcome = z.infer<typeof outcomeSchema>;
/** One check: its name, colour and what it found (a problem key, another supplier's name). */
export const checkSchema = z.looseObject({
  check: z.string(),
  outcome: outcomeSchema,
  problem: z.string().optional(),
  name: z.string().optional(),
  hint: z.string().optional(),
});
export type Check = z.infer<typeof checkSchema>;
export const checkResultSchema = z.object({ outcome: outcomeSchema, checks: z.array(checkSchema) });
export type CheckResult = z.infer<typeof checkResultSchema>;

export const submittedSchema = checkResultSchema.extend({
  request_id: z.string(),
  status: z.enum(['pending', 'applied', 'approved']),
});
export type Submitted = z.infer<typeof submittedSchema>;

/** A row of supplier_change_requests; RLS shows it to its owner and to who may decide it. */
export const changeRequestSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  change_kind: z.enum(['rename', 'entity_kind', 'contact']),
  contact_kind: z.string().nullable(),
  old_value: z.string().nullable(),
  /** Null when the change deletes a contact. */
  new_value: z.string().nullable(),
  reason: z.string().nullable(),
  checks: z.array(checkSchema),
  created_at: z.string(),
  created_by: z.string().nullable(),
  /** Who proposed it: staff, or the supplier from its personal area (supplier-portal spec). */
  origin: z.enum(['staff', 'supplier']).optional(),
});
export type ChangeRequest = z.infer<typeof changeRequestSchema>;
