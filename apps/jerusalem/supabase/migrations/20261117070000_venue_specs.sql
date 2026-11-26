-- Halls and venues (documentation/catalog-portal-spec-he.md, stage D). A venue is an ordinary
-- supplier with at most one row of hall details. The details are public in the registry
-- documents, so every member reads them; only the admin load writes them. The catalog adds
-- column 12 per supplier: the venue details, or null.

create table public.venue_specs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null unique references public.suppliers (id) on delete cascade,
  capacity integer check (capacity between 1 and 100000),
  capacity_text text check (length(capacity_text) <= 200),
  hall_size text check (length(hall_size) <= 200),
  stage_size text check (length(stage_size) <= 200),
  screen text check (length(screen) <= 200),
  sound text check (length(sound) <= 200),
  lighting text check (length(lighting) <= 200),
  survey_year integer check (survey_year between 2000 and 2100),
  source_registry_id uuid references public.registries (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index venue_specs_registry_idx on public.venue_specs (source_registry_id);
alter table public.venue_specs enable row level security;
revoke all on public.venue_specs from public, anon, authenticated;
grant select on public.venue_specs to authenticated;
create policy venue_specs_read on public.venue_specs for select to authenticated
  using ((select private.is_member()));
select private.track_table('public.venue_specs');
create trigger catalog_version after insert or update or delete or truncate
  on public.venue_specs for each statement execute function private.bump_catalog_version();

-- Admin only. Each row names its registry and the hall as published there; the supplier is
-- the one with a membership in that registry under that name. A row that names no single
-- supplier is returned, never guessed. A newer survey replaces an older one, not the reverse.
create function public.import_venue_specs(file jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  found_ids uuid[];
  registry uuid;
  matched integer := 0;
  unmatched jsonb := '[]'::jsonb;
begin
  if not private.is_admin() then
    raise exception 'Only an admin loads venue details' using errcode = '42501';
  end if;
  if jsonb_typeof(file -> 'rows') is distinct from 'array' then
    raise exception 'Expected rows' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(file -> 'rows')
    order by (value ->> 'survey_year') nulls first loop
    select array_agg(distinct m.supplier_id), (array_agg(r.id))[1] into found_ids, registry
    from public.memberships m
    join public.registry_versions v on v.id = m.registry_version_id
    join public.registries r on r.id = v.registry_id
    join public.suppliers s on s.id = m.supplier_id
    where r.name = item ->> 'registry' and s.status <> 'merged'
      and coalesce(m.name_as_published, s.display_name) = item ->> 'name';
    if cardinality(found_ids) is distinct from 1 then
      unmatched := unmatched || jsonb_build_array(jsonb_build_object(
        'registry', item ->> 'registry', 'name', item ->> 'name',
        'suppliers', coalesce(cardinality(found_ids), 0)));
      continue;
    end if;
    insert into public.venue_specs as t (supplier_id, capacity, capacity_text, hall_size,
      stage_size, screen, sound, lighting, survey_year, source_registry_id)
    select found_ids[1], (item ->> 'capacity')::integer, item ->> 'capacity_text',
      item ->> 'hall_size', item ->> 'stage_size', item ->> 'screen', item ->> 'sound',
      item ->> 'lighting', (item ->> 'survey_year')::integer,
      registry
    on conflict (supplier_id) do update set capacity = excluded.capacity,
      capacity_text = excluded.capacity_text, hall_size = excluded.hall_size,
      stage_size = excluded.stage_size, screen = excluded.screen, sound = excluded.sound,
      lighting = excluded.lighting, survey_year = excluded.survey_year,
      source_registry_id = excluded.source_registry_id, updated_at = now()
    where t.survey_year is null or excluded.survey_year >= t.survey_year;
    matched := matched + 1;
  end loop;
  return jsonb_build_object('matched', matched, 'unmatched', unmatched);
end;
$$;
revoke all on function public.import_venue_specs(jsonb) from public, anon;
grant execute on function public.import_venue_specs(jsonb) to authenticated;

create or replace function private.catalog_suppliers()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with version_at as (
    select v.id, (row_number() over (order by v.id) - 1)::int as at
    from public.registry_versions v
  ), field_at as (
    select f.id, (row_number() over (order by f.id) - 1)::int as at
    from public.registry_fields f
  ), document_at as (
    select d.id, (row_number() over (order by d.id) - 1)::int as at
    from public.source_documents d
  ), names as (
    select n.supplier_id, jsonb_agg(jsonb_build_array(
      case when n.name = s.display_name then '0'::jsonb else to_jsonb(n.name) end,
      nullif(n.kind, 'as_published'), d.at) order by n.id) as rows
    from public.supplier_names n join public.suppliers s on s.id = n.supplier_id
    left join document_at d on d.id = n.source_document_id
    group by n.supplier_id
  ), memberships as (
    select m.supplier_id, jsonb_agg(jsonb_build_array(v.at, f.at,
      case when m.name_as_published = s.display_name then '0'::jsonb
        else to_jsonb(m.name_as_published) end, m.source_page, m.registered_from,
      m.registered_until, m.engagement_started_on, nullif(m.dates_source, 'unknown'),
      nullif(m.review_status, 'needs_review'))
      order by m.id) as rows
    from public.memberships m join public.suppliers s on s.id = m.supplier_id
    -- A version the caller cannot see has no position; such a row is left out,
    -- as the site already ignores a membership without its registry.
    join version_at v on v.id = m.registry_version_id
    left join field_at f on f.id = m.registry_field_id
    where m.review_status not in ('rejected', 'removed')
    group by m.supplier_id
  ), identifiers as (
    select i.supplier_id, bool_or(i.review_status = 'verified') as verified
    from public.supplier_identifiers i where i.review_status <> 'rejected'
    group by i.supplier_id
  ), candidates as (
    select distinct c.supplier_id from public.identifier_candidates c where c.status = 'pending'
  ), venues as (
    select v.supplier_id, jsonb_build_array(v.capacity, v.capacity_text, v.hall_size,
      v.stage_size, v.screen, v.sound, v.lighting, v.survey_year) as row
    from public.venue_specs v
  ), contacts as (
    select c.supplier_id, jsonb_agg(distinct c.kind order by c.kind) as kinds
    from public.supplier_contacts c where c.status = 'current' group by c.supplier_id
  )
  select coalesce((select jsonb_agg(jsonb_build_array(s.id, s.display_name,
      nullif(s.entity_kind, 'unknown'), nullif(s.status, 'active'), s.website,
      nullif(s.review_status, 'needs_review'), s.note,
      coalesce(n.rows, '[]'::jsonb), coalesce(m.rows, '[]'::jsonb),
      coalesce(c.kinds, '[]'::jsonb),
      case when i.verified then 'verified'
        when i.supplier_id is not null or p.supplier_id is not null then 'pending' end,
      case when s.status = 'inactive' then jsonb_build_array(s.status_reason, s.status_source,
        s.status_changed_on) end, vs.row) order by s.id)
      from public.suppliers s left join names n on n.supplier_id = s.id
      left join memberships m on m.supplier_id = s.id
      left join contacts c on c.supplier_id = s.id
      left join identifiers i on i.supplier_id = s.id
      left join candidates p on p.supplier_id = s.id
      left join venues vs on vs.supplier_id = s.id
      where s.status <> 'merged'), '[]'::jsonb)
$$;
