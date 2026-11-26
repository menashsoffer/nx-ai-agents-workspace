-- Supplier status and its reason (documentation/catalog-portal-spec-he.md, stage B).
-- An inactive supplier keeps why, according to whom and since when, and the database
-- refuses to start an engagement or record an approach with it. The catalog adds two
-- columns per supplier: the identifier state and, for an inactive one, the reason.

alter table public.suppliers
  add column status_reason text check (length(trim(status_reason)) between 2 and 500),
  add column status_source text check (length(trim(status_source)) between 2 and 500),
  add column status_changed_on date,
  add constraint suppliers_inactive_has_reason check (
    status <> 'inactive' or (status_reason is not null and status_changed_on is not null)
  );

-- Only an admin changes whether a supplier is active. A change to inactive needs a reason
-- and a date; returning to active clears them, and the audit log keeps the history.
create function public.set_supplier_status(target uuid, change jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  inactive boolean;
begin
  if not private.is_admin() then
    raise exception 'Only an admin changes a supplier status' using errcode = '42501';
  end if;
  if jsonb_typeof(change -> 'active') is distinct from 'boolean' then
    raise exception 'active must be true or false' using errcode = '22023';
  end if;
  inactive := not (change ->> 'active')::boolean;
  update public.suppliers set
    status = case when inactive then 'inactive' else 'active' end,
    status_reason = case when inactive then nullif(trim(change ->> 'reason'), '') end,
    status_source = case when inactive then nullif(trim(change ->> 'source'), '') end,
    status_changed_on = case when inactive then (change ->> 'changedOn')::date end,
    updated_at = now()
  where id = target and status <> 'merged';
  if not found then
    raise exception 'Supplier not found or merged' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_supplier_status(uuid, jsonb) from public, anon;
grant execute on function public.set_supplier_status(uuid, jsonb) to authenticated;

-- Reads the supplier as the owner, so a caller who cannot see the row is still refused.
create function private.require_active_supplier()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = new.supplier_id and s.status = 'active'
  ) then
    raise exception 'The supplier is not active' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.require_active_supplier() from public, anon, authenticated;

create trigger require_active_supplier before insert or update of supplier_id
  on public.engagement_requests for each row execute function private.require_active_supplier();
create trigger require_active_supplier before insert or update of supplier_id
  on public.supplier_approaches for each row execute function private.require_active_supplier();

-- The catalog now reflects identifiers, so their changes must refresh cached copies.
create trigger catalog_version after insert or update or delete or truncate
  on public.supplier_identifiers for each statement execute function private.bump_catalog_version();
create trigger catalog_version after insert or update or delete or truncate
  on public.identifier_candidates for each statement
  execute function private.bump_catalog_version();

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
        s.status_changed_on) end) order by s.id)
      from public.suppliers s left join names n on n.supplier_id = s.id
      left join memberships m on m.supplier_id = s.id
      left join contacts c on c.supplier_id = s.id
      left join identifiers i on i.supplier_id = s.id
      left join candidates p on p.supplier_id = s.id
      where s.status <> 'merged'), '[]'::jsonb)
$$;
