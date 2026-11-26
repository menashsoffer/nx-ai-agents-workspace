-- Suppliers as one row per legal entity, with identifiers, alternative names and
-- contacts in their own tables. The live flat table keeps working under a new name
-- until the site reads from the new model.

alter table public.suppliers rename to legacy_suppliers;
alter table public.legacy_suppliers rename constraint suppliers_pkey to legacy_suppliers_pkey;

-- Principle: the person who enters a row is not the one who verifies it.
create function private.guard_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_status = 'verified'
    and (tg_op = 'INSERT' or old.review_status is distinct from 'verified') then
    if auth.uid() is not null and not private.has_role(array['unit_manager']) then
      raise exception 'Only a unit manager or an admin can verify' using errcode = '42501';
    end if;
    if auth.uid() is not null and auth.uid() = new.created_by then
      raise exception 'A row cannot be verified by the person who entered it'
        using errcode = '42501';
    end if;
    new.verified_by := coalesce(auth.uid(), new.verified_by);
    new.verified_at := now();
  elsif new.review_status <> 'verified' then
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_verification() from public, anon, authenticated;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) between 1 and 300),
  normalized_name text generated always as (private.normalize_name(display_name)) stored,
  entity_kind text not null default 'unknown' check (entity_kind in (
    'company', 'sole_trader', 'nonprofit', 'partnership', 'public_body', 'individual', 'unknown'
  )),
  status text not null default 'active' check (status in ('active', 'merged', 'inactive')),
  merged_into_id uuid references public.suppliers (id) on delete restrict,
  website text check (website ~ '^https?://'),
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'verified', 'rejected')),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((status = 'merged') = (merged_into_id is not null)),
  check (merged_into_id is null or merged_into_id <> id)
);
create index suppliers_normalized_trgm_idx
  on public.suppliers using gin (normalized_name extensions.gin_trgm_ops);
create index suppliers_merged_into_idx on public.suppliers (merged_into_id);
create index suppliers_verified_by_idx on public.suppliers (verified_by);

-- Company, nonprofit and VAT dealer numbers from the Registrar of Companies and the
-- Registrar of Nonprofits (the data GuideStar Israel publishes), looked up by name.
create table public.supplier_identifiers (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  scheme text not null check (scheme in ('company', 'nonprofit', 'vat_dealer', 'personal_id')),
  value text not null check (value ~ '^[0-9]{5,9}$'),
  source text not null default 'manual' check (source in (
    'companies_registrar', 'nonprofits_registrar', 'guidestar', 'municipality', 'manual'
  )),
  registrar_name text check (length(registrar_name) <= 300),
  registrar_status text check (length(registrar_status) <= 100),
  checked_at timestamptz,
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'verified', 'rejected')),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index supplier_identifiers_value_idx
  on public.supplier_identifiers (scheme, value) where review_status <> 'rejected';
create index supplier_identifiers_supplier_idx on public.supplier_identifiers (supplier_id);
create index supplier_identifiers_verified_by_idx on public.supplier_identifiers (verified_by);

create table public.supplier_names (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 300),
  normalized_name text generated always as (private.normalize_name(name)) stored,
  kind text not null default 'as_published'
    check (kind in ('as_published', 'trade_name', 'former_name', 'registrar_name')),
  source_document_id uuid references public.source_documents (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index supplier_names_unique_idx
  on public.supplier_names (supplier_id, normalized_name, kind);
create index supplier_names_trgm_idx
  on public.supplier_names using gin (normalized_name extensions.gin_trgm_ops);
create index supplier_names_source_idx on public.supplier_names (source_document_id);

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  kind text not null check (kind in ('email', 'phone', 'address', 'website', 'contact_person')),
  value text not null check (length(trim(value)) between 1 and 500),
  normalized_value text generated always as (
    case kind
      when 'email' then lower(trim(value))
      when 'phone' then regexp_replace(value, '[^0-9+]', '', 'g')
      else trim(value)
    end
  ) stored,
  is_valid boolean generated always as (
    case kind
      when 'email' then trim(value) ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
      when 'phone' then regexp_replace(value, '[^0-9]', '', 'g') ~ '^(972)?0?[2-9][0-9]{7,8}$'
      else true
    end
  ) stored,
  is_primary boolean not null default false,
  source_document_id uuid references public.source_documents (id) on delete restrict,
  status text not null default 'current' check (status in ('current', 'outdated', 'disputed')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index supplier_contacts_value_idx
  on public.supplier_contacts (supplier_id, kind, normalized_value);
create unique index supplier_contacts_primary_idx
  on public.supplier_contacts (supplier_id, kind) where is_primary;
create index supplier_contacts_source_idx on public.supplier_contacts (source_document_id);

-- Named to sort after stamp_row, so created_by is already set when it runs.
create trigger verify_row before insert or update on public.suppliers
  for each row execute function private.guard_verification();
create trigger verify_row before insert or update on public.supplier_identifiers
  for each row execute function private.guard_verification();
select private.track_table('public.suppliers');
select private.track_table('public.supplier_identifiers', '{value}');
select private.track_table('public.supplier_names');
select private.track_table('public.supplier_contacts');

alter table public.suppliers enable row level security;
alter table public.supplier_identifiers enable row level security;
alter table public.supplier_names enable row level security;
alter table public.supplier_contacts enable row level security;
revoke all on public.suppliers, public.supplier_identifiers, public.supplier_names,
  public.supplier_contacts from public, anon, authenticated;

grant select on public.suppliers, public.supplier_identifiers, public.supplier_names,
  public.supplier_contacts to authenticated;
grant insert (display_name, entity_kind, website, note),
  update (display_name, entity_kind, website, note, review_status)
  on public.suppliers to authenticated;
grant insert (supplier_id, scheme, value, source, registrar_name, registrar_status, checked_at),
  update (review_status, registrar_name, registrar_status, checked_at)
  on public.supplier_identifiers to authenticated;
grant insert (supplier_id, name, kind, source_document_id), delete
  on public.supplier_names to authenticated;
grant insert (supplier_id, kind, value, is_primary, source_document_id),
  update (is_primary, status) on public.supplier_contacts to authenticated;

-- Published contacts are public on the municipality site, so every member sees them.
-- A personal ID number is not published and stays with editors and managers.
create policy suppliers_read on public.suppliers for select to authenticated
  using ((select private.is_member()));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check ((select private.has_role(array['editor', 'unit_manager'])));
create policy suppliers_update on public.suppliers for update to authenticated
  using ((select private.has_role(array['editor', 'unit_manager'])) and status <> 'merged')
  with check ((select private.has_role(array['editor', 'unit_manager'])));

create policy supplier_identifiers_read on public.supplier_identifiers for select to authenticated
  using (
    ((select private.is_member()) and scheme <> 'personal_id')
    or (select private.has_role(array['editor', 'unit_manager']))
  );
create policy supplier_identifiers_insert on public.supplier_identifiers for insert
  to authenticated with check ((select private.has_role(array['editor', 'unit_manager'])));
create policy supplier_identifiers_update on public.supplier_identifiers for update
  to authenticated using ((select private.has_role(array['editor', 'unit_manager'])))
  with check ((select private.has_role(array['editor', 'unit_manager'])));

create policy supplier_names_read on public.supplier_names for select to authenticated
  using ((select private.is_member()));
create policy supplier_names_insert on public.supplier_names for insert to authenticated
  with check ((select private.has_role(array['editor', 'unit_manager'])));
create policy supplier_names_delete on public.supplier_names for delete to authenticated
  using ((select private.is_admin()));

create policy supplier_contacts_read on public.supplier_contacts for select to authenticated
  using ((select private.is_member()));
create policy supplier_contacts_insert on public.supplier_contacts for insert to authenticated
  with check ((select private.has_role(array['editor', 'unit_manager'])));
create policy supplier_contacts_update on public.supplier_contacts for update to authenticated
  using ((select private.has_role(array['editor', 'unit_manager'])))
  with check ((select private.has_role(array['editor', 'unit_manager'])));
