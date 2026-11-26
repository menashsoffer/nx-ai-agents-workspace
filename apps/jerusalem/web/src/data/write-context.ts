import type { PublicSchema } from '../database.types.ts';
import { mayWriteUnit, type Access } from './access.ts';
import type { CatalogData } from './catalog.ts';
import type { DataClient } from './client.ts';

type Identifier = PublicSchema['supplier_identifiers']['Row'];
export interface RegistryOption {
  versionId: string;
  registryId: string;
  name: string;
  validFrom: string | null;
  validUntil: string | null;
  /** False for a pool whose status nobody has confirmed yet (most pools loaded from files). */
  statusKnown: boolean;
  hasSource: boolean;
}
export interface WriteContext {
  catalog: CatalogData;
  identifiers: Identifier[];
  versions: RegistryOption[];
}

/**
 * The pool versions the user may add to: every pool that is not closed (the database does not
 * restrict by status, and most pools have an unconfirmed status), sorted by name.
 */
export function writableVersions(catalog: CatalogData, access: Access): RegistryOption[] {
  const registries = new Map(catalog.registries.map((row) => [row.id, row]));
  const rows = catalog.versions.flatMap((version) => {
    const registry = registries.get(version.registry_id);
    if (!registry || registry.status === 'closed') return [];
    const permitted =
      access.state === 'active' &&
      (access.admin ||
        (registry.owner_unit_id !== null && mayWriteUnit(access, registry.owner_unit_id)));
    if (!permitted || !catalog.fields.some((field) => field.registry_id === registry.id)) return [];
    return [
      {
        versionId: version.id,
        registryId: registry.id,
        name: registry.name,
        validFrom: version.valid_from,
        validUntil: version.valid_until,
        statusKnown: registry.status === 'active',
        hasSource: version.source_document_id !== null,
      },
    ];
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export async function loadWriteContext(
  client: DataClient,
  catalog: CatalogData,
  access: Access,
): Promise<WriteContext> {
  if (!access.editor || access.state !== 'active') throw new Error('אין לך הרשאה לערוך ספקים.');
  const identifiers = await client.list('supplier_identifiers', {
    scheme: 'in.(company,nonprofit,vat_dealer)',
    review_status: 'neq.rejected',
  });
  return { catalog, identifiers, versions: writableVersions(catalog, access) };
}
