-- Staging for extracted rows, and memberships: a supplier listed in a registry
-- version under a field. Extraction scripts write only to staging; rows reach
-- memberships through public.promote_import_row after review.

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid references public.source_documents (id) on delete restrict,
  registry_id uuid references public.registries (id) on delete restrict,
  registry_version_id uuid references public.registry_versions (id) on delete restrict,
  script_name text not null check (length(script_name) <= 200),
  script_version text check (length(script_version) <= 100),
  row_count integer not null default 0 check (row_count >= 0),
  status text not null default 'loaded'
    check (status in ('loaded', 'in_review', 'done', 'failed')),
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index import_batches_source_idx on public.import_batches (source_document_id);
create index import_batches_registry_idx on public.import_batches (registry_id);
create index import_batches_version_idx on public.import_batches (registry_version_id);

create table public.import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches (id) on delete restrict,
  row_number integer not null check (row_number > 0),
  source_page integer check (source_page > 0),
  raw jsonb not null check (jsonb_typeof(raw) = 'object' and octet_length(raw::text) <= 20000),
  status text not null default 'pending'
    check (status in ('pending', 'promoted', 'rejected', 'duplicate')),
  duplicate_of bigint references public.import_rows (id) on delete restrict,
  reviewer_note text check (length(reviewer_note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (batch_id, row_number),
  check ((status = 'duplicate') = (duplicate_of is not null)),
  check (status <> 'rejected' or length(trim(coalesce(reviewer_note, ''))) >= 2)
);
create index import_rows_status_idx on public.import_rows (batch_id, status);
create index import_rows_duplicate_idx on public.import_rows (duplicate_of);

-- Registration validity and the engagement start date are separate facts. Either
-- may come from the published registry document, from our internal registry, or
-- from the municipality's own registry, and dates_source records which.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  registry_version_id uuid not null references public.registry_versions (id) on delete restrict,
  registry_field_id uuid references public.registry_fields (id) on delete restrict,
  name_as_published text check (length(name_as_published) <= 300),
  source_page integer check (source_page > 0),
  registered_from date,
  registered_until date,
  engagement_started_on date,
  dates_source text not null default 'unknown' check (dates_source in (
    'registry_document', 'internal_registry', 'municipal_registry', 'unknown'
  )),
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'verified', 'rejected', 'removed')),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  import_row_id bigint references public.import_rows (id) on delete restrict,
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (registered_until is null or registered_from is null
    or registered_until >= registered_from)
);
create unique index memberships_unique_idx on public.memberships (
  supplier_id, registry_version_id,
  coalesce(registry_field_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index memberships_version_idx on public.memberships (registry_version_id);
create index memberships_field_idx on public.memberships (registry_field_id);
create index memberships_import_row_idx on public.memberships (import_row_id);
create index memberships_verified_by_idx on public.memberships (verified_by);
create index memberships_until_idx on public.memberships (registered_until)
  where review_status = 'verified';

select private.track_table('public.import_batches');
select private.track_table('public.import_rows', '{raw}');
select private.track_table('public.memberships');
create trigger verify_row before insert or update on public.memberships
  for each row execute function private.guard_verification();

-- The unit that owns the registry a version belongs to.
create function private.version_unit(version_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.owner_unit_id
  from public.registry_versions v
  join public.registries r on r.id = v.registry_id
  where v.id = version_id
$$;
revoke all on function private.version_unit(uuid) from public, anon;
grant execute on function private.version_unit(uuid) to authenticated;

alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.memberships enable row level security;
revoke all on public.import_batches, public.import_rows, public.memberships
  from public, anon, authenticated;

grant select, insert, update on public.import_batches to authenticated;
grant select, insert, update (status, duplicate_of, reviewer_note)
  on public.import_rows to authenticated;
create policy import_batches_admin on public.import_batches for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy import_rows_admin on public.import_rows for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

grant select on public.memberships to authenticated;
grant insert (supplier_id, registry_version_id, registry_field_id, name_as_published,
  source_page, registered_from, registered_until, engagement_started_on, dates_source, note),
  update (registry_field_id, registered_from, registered_until, engagement_started_on,
  dates_source, review_status, note)
  on public.memberships to authenticated;
create policy memberships_read on public.memberships for select to authenticated
  using (
    ((select private.is_member()) and review_status = 'verified')
    or private.has_role(array['editor', 'unit_manager'], private.version_unit(registry_version_id))
  );
create policy memberships_insert on public.memberships for insert to authenticated
  with check (
    private.has_role(array['editor', 'unit_manager'], private.version_unit(registry_version_id))
  );
create policy memberships_update on public.memberships for update to authenticated
  using (
    private.has_role(array['editor', 'unit_manager'], private.version_unit(registry_version_id))
  )
  with check (
    private.has_role(array['editor', 'unit_manager'], private.version_unit(registry_version_id))
  );
