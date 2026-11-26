-- Registries (the municipality's supplier and consultant pools), the documents
-- they were published in, their versions, and a managed category list.

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~ '^https?://'),
  file_name text check (length(file_name) <= 300),
  media_type text check (length(media_type) <= 100),
  published_on date,
  retrieved_at timestamptz,
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count > 0),
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index source_documents_content_idx on public.source_documents (content_sha256);
create index source_documents_url_idx on public.source_documents (url);

-- kind follows the regulations: a consultants pool under 3(8) and the 8/2016
-- circular, a supplier list for small tenders under regulation 8, or other.
create table public.registries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 300),
  owner_unit_id uuid references public.org_units (id) on delete restrict,
  kind text not null default 'unknown'
    check (kind in ('consultants_3_8', 'zuta_suppliers_8', 'other', 'unknown')),
  keeper text not null default 'municipality' check (keeper in ('municipality', 'internal')),
  status text not null default 'active' check (status in ('active', 'closed', 'unknown')),
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index registries_name_idx on public.registries (lower(trim(name)));
create index registries_owner_idx on public.registries (owner_unit_id);

create table public.registry_versions (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid not null references public.registries (id) on delete restrict,
  source_document_id uuid references public.source_documents (id) on delete restrict,
  valid_from date,
  valid_until date,
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index registry_versions_registry_idx on public.registry_versions (registry_id);
create index registry_versions_source_idx on public.registry_versions (source_document_id);
create unique index registry_versions_source_unique_idx
  on public.registry_versions (registry_id, source_document_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  description text check (length(description) <= 2000),
  parent_id uuid references public.categories (id) on delete restrict,
  synonyms text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index categories_parent_idx on public.categories (parent_id);
create unique index categories_name_idx
  on public.categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name)));

-- A field exactly as a registry document words it, mapped later to a category.
create table public.registry_fields (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid not null references public.registries (id) on delete restrict,
  source_text text not null check (length(trim(source_text)) between 1 and 500),
  source_code text check (length(source_code) <= 40),
  category_id uuid references public.categories (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index registry_fields_text_idx
  on public.registry_fields (registry_id, lower(trim(source_text)));
create index registry_fields_category_idx on public.registry_fields (category_id);

create table public.category_requests (
  id uuid primary key default gen_random_uuid(),
  proposed_name text not null check (length(trim(proposed_name)) between 2 and 200),
  description text not null check (length(trim(description)) between 5 and 2000),
  parent_id uuid references public.categories (id) on delete restrict,
  source_reference text check (length(source_reference) <= 2000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'linked')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 2000),
  resolved_category_id uuid references public.categories (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check (status = 'pending' or length(trim(coalesce(decision_note, ''))) >= 2),
  check ((status in ('approved', 'linked')) = (resolved_category_id is not null))
);
create index category_requests_parent_idx on public.category_requests (parent_id);
create index category_requests_resolved_idx on public.category_requests (resolved_category_id);
create index category_requests_decided_by_idx on public.category_requests (decided_by);

select private.track_table('public.source_documents');
select private.track_table('public.registries');
select private.track_table('public.registry_versions');
select private.track_table('public.categories');
select private.track_table('public.registry_fields');
select private.track_table('public.category_requests');

alter table public.source_documents enable row level security;
alter table public.registries enable row level security;
alter table public.registry_versions enable row level security;
alter table public.categories enable row level security;
alter table public.registry_fields enable row level security;
alter table public.category_requests enable row level security;
revoke all on public.source_documents, public.registries, public.registry_versions,
  public.categories, public.registry_fields, public.category_requests
  from public, anon, authenticated;

-- Reference data: every active member reads it, admins maintain it.
grant select, insert, update on public.source_documents, public.registries,
  public.registry_versions, public.categories, public.registry_fields to authenticated;

create policy source_documents_read on public.source_documents for select to authenticated
  using ((select private.is_member()));
create policy source_documents_write on public.source_documents for insert to authenticated
  with check ((select private.is_admin()));
create policy source_documents_update on public.source_documents for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy registries_read on public.registries for select to authenticated
  using ((select private.is_member()));
create policy registries_write on public.registries for insert to authenticated
  with check ((select private.is_admin()));
create policy registries_update on public.registries for update to authenticated
  using ((select private.is_admin()) or private.manages_unit(owner_unit_id))
  with check ((select private.is_admin()) or private.manages_unit(owner_unit_id));

create policy registry_versions_read on public.registry_versions for select to authenticated
  using ((select private.is_member()));
create policy registry_versions_write on public.registry_versions for insert to authenticated
  with check ((select private.is_admin()));
create policy registry_versions_update on public.registry_versions for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy categories_read on public.categories for select to authenticated
  using (((select private.is_member()) and active) or (select private.is_admin()));
create policy categories_write on public.categories for insert to authenticated
  with check ((select private.is_admin()));
create policy categories_update on public.categories for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy registry_fields_read on public.registry_fields for select to authenticated
  using ((select private.is_member()));
create policy registry_fields_write on public.registry_fields for insert to authenticated
  with check ((select private.is_admin()));
create policy registry_fields_update on public.registry_fields for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Requests: members propose, admins decide through public.decide_category_request.
grant select on public.category_requests to authenticated;
grant insert (proposed_name, description, parent_id, source_reference)
  on public.category_requests to authenticated;
create policy category_requests_read on public.category_requests for select to authenticated
  using (created_by = (select auth.uid()) or (select private.is_admin()));
create policy category_requests_insert on public.category_requests for insert to authenticated
  with check ((select private.is_member()) and status = 'pending');
