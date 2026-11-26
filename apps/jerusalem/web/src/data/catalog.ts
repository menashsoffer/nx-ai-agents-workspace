import type { PublicSchema } from '../database.types.ts';

type Row<T extends keyof PublicSchema> = PublicSchema[T]['Row'];
export type IdentifierState = 'verified' | 'pending' | null;
/** A hall's details as the registry document published them; empty fields are null. */
export interface Venue {
  capacity: number | null;
  capacity_text: string | null;
  hall_size: string | null;
  stage_size: string | null;
  screen: string | null;
  sound: string | null;
  lighting: string | null;
  survey_year: number | null;
}
export interface CatalogData {
  suppliers: (Pick<
    Row<'suppliers'>,
    | 'id'
    | 'display_name'
    | 'entity_kind'
    | 'status'
    | 'website'
    | 'review_status'
    | 'note'
    | 'status_reason'
    | 'status_source'
    | 'status_changed_on'
  > & {
    /** `verified`, `pending` or null, from the identifiers and candidates the caller sees. */
    identifier_state: IdentifierState;
    venue: Venue | null;
  })[];
  names: Pick<Row<'supplier_names'>, 'supplier_id' | 'name' | 'kind' | 'source_document_id'>[];
  memberships: Pick<
    Row<'memberships'>,
    | 'supplier_id'
    | 'registry_version_id'
    | 'registry_field_id'
    | 'name_as_published'
    | 'source_page'
    | 'registered_from'
    | 'registered_until'
    | 'engagement_started_on'
    | 'dates_source'
    | 'review_status'
  >[];
  versions: Pick<
    Row<'registry_versions'>,
    'id' | 'registry_id' | 'source_document_id' | 'valid_from' | 'valid_until'
  >[];
  registries: Pick<Row<'registries'>, 'id' | 'name' | 'owner_unit_id' | 'status'>[];
  fields: Pick<Row<'registry_fields'>, 'id' | 'registry_id' | 'source_text'>[];
  fieldCategories: Pick<Row<'registry_field_categories'>, 'registry_field_id' | 'category_id'>[];
  categories: Pick<Row<'categories'>, 'id' | 'name' | 'parent_id'>[];
  units: Pick<Row<'org_units'>, 'id' | 'name'>[];
  /** Kinds of current contact details per supplier; the values come from supplier_detail. */
  contactKinds: { supplier_id: string; kind: string }[];
  documents: Pick<Row<'source_documents'>, 'id' | 'url'>[];
}
export type ContactRow = Pick<
  Row<'supplier_contacts'>,
  'id' | 'supplier_id' | 'kind' | 'value' | 'is_valid' | 'source_document_id' | 'status'
>;
