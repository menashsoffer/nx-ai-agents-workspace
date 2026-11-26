// Calls behind the import screen (supplier-excel-import-spec-he.md, sections 4 and 6). Every call
// is checked again in the database: admin only, sizes, field rules.
import { rpc, requireRoles, rows, freshToken } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { failedResponse } from '../../../data/client.ts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../../data/environment.ts';
import type { Candidate, Choice } from '../model/decisions.ts';
import type { StagedRow } from '../model/rows.ts';
import type { Edited } from '../model/values.ts';

const registrySchema = z.object({ id: z.string(), name: z.string(), status: z.string() });
const versionSchema = z.object({
  id: z.string(),
  registry_id: z.string(),
  valid_from: z.string().nullable(),
  created_at: z.string(),
});
export type Registry = z.infer<typeof registrySchema>;
export type Version = z.infer<typeof versionSchema>;

const batchSchema = z.object({
  id: z.string(),
  status: z.string(),
  row_count: z.number(),
  created_at: z.string(),
  registry_id: z.string().nullable(),
});
export type Batch = z.infer<typeof batchSchema>;

export interface ImportContext {
  registries: Registry[];
  versions: Version[];
  drafts: Batch[];
}

export async function loadContext(): Promise<ImportContext> {
  await requireRoles(['admin']);
  const [registries, versions, drafts] = await Promise.all([
    rows('registries', { status: 'neq.closed', order: 'name.asc' }, z.array(registrySchema)),
    rows('registry_versions', { order: 'created_at.desc' }, z.array(versionSchema)),
    rows(
      'import_batches',
      { script_name: 'eq.excel_import', status: 'neq.done', order: 'created_at.desc' },
      z.array(batchSchema),
    ),
  ]);
  return { registries, versions, drafts };
}

/** Puts the original file in the private bucket. The same file again is not an error. */
export async function uploadSource(path: string, bytes: Uint8Array<ArrayBuffer>, type: string) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/source-files/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${await freshToken()}`,
      'Content-Type': type,
    },
    body: new Blob([bytes], { type }),
  });
  if (response.ok || response.status === 409) return;
  const body = await response.clone().text();
  if (/already exists|duplicate/i.test(body)) return;
  throw await failedResponse(response);
}

const candidateSchema = z.object({ id: z.string(), name: z.string(), match_rank: z.number() });
const stagedSchema = z.object({
  batch_id: z.string().nullable(),
  duplicate: z.boolean(),
  rows: z.array(z.object({ row_id: z.number(), candidates: z.array(candidateSchema) })).optional(),
});
export type Staged = z.infer<typeof stagedSchema>;

export interface Target {
  registry_id?: string;
  registry_version_id?: string;
  registry_name?: string;
}

export function stage(
  file: { name: string; path: string; sha256: string },
  target: Target,
  staged: readonly StagedRow[],
): Promise<Staged> {
  const batch = {
    file_name: file.name,
    storage_path: file.path,
    content_sha256: file.sha256,
    ...target,
    rows: staged.map(({ row_number, raw, edited }) => ({ row_number, raw, edited })),
  };
  return rpc('stage_excel_import', { batch }, stagedSchema);
}

export const reopen = (batchId: string) =>
  rpc('stage_excel_import', { batch: { batch_id: batchId } }, stagedSchema);

const rowSchema = z.object({
  id: z.number(),
  row_number: z.number(),
  raw: z.record(z.string(), z.unknown()),
  edited: z.record(z.string(), z.string().nullable()).nullable(),
  status: z.enum(['pending', 'promoted', 'rejected', 'duplicate']),
  decision: z.enum(['new', 'link', 'hold']).nullable(),
  target_supplier_id: z.string().nullable(),
  error: z.string().nullable(),
  reviewer_note: z.string().nullable(),
});
export type ImportRow = z.infer<typeof rowSchema>;

export const batchRows = (batchId: string) =>
  rows('import_rows', { batch_id: `eq.${batchId}`, order: 'row_number.asc' }, z.array(rowSchema));

export interface Decision {
  rowId: number;
  choice: Choice;
  edited: Edited;
}

/** Saves the admin's decisions, then promotes each decided row in its own transaction. */
export async function approve(batchId: string, decisions: readonly Decision[]) {
  const payload = decisions.map(({ rowId, choice, edited }) => ({
    row_id: rowId,
    decision: choice.decision,
    edited,
    ...(choice.decision === 'link' ? { target_supplier_id: choice.target } : {}),
    ...(choice.decision === 'skip' ? { note: choice.note } : {}),
  }));
  if (payload.length) await rpc('decide_import_rows', { decisions: payload }, z.number());
  return rpc(
    'apply_import_batch',
    { batch: batchId },
    z.object({ promoted: z.number(), failed: z.number(), pending: z.number() }),
  );
}

export type { Candidate };
