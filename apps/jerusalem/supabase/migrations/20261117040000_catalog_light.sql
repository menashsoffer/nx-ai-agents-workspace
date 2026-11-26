-- A lighter catalog (documentation/catalog-portal-spec-he.md, stage A). Contact values leave
-- the snapshot: each supplier carries only the kinds of current contacts it has, and the
-- values are read per supplier through supplier_detail. Nested rows point at versions,
-- fields and documents by their position in the snapshot's arrays instead of repeating
-- UUIDs. Both sides are read under the same RLS and ordered by id, so positions match.

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
  ), contacts as (
    select c.supplier_id, jsonb_agg(distinct c.kind order by c.kind) as kinds
    from public.supplier_contacts c where c.status = 'current' group by c.supplier_id
  )
  select coalesce((select jsonb_agg(jsonb_build_array(s.id, s.display_name,
      nullif(s.entity_kind, 'unknown'), nullif(s.status, 'active'), s.website,
      nullif(s.review_status, 'needs_review'), s.note,
      coalesce(n.rows, '[]'::jsonb), coalesce(m.rows, '[]'::jsonb),
      coalesce(c.kinds, '[]'::jsonb)) order by s.id)
      from public.suppliers s left join names n on n.supplier_id = s.id
      left join memberships m on m.supplier_id = s.id
      left join contacts c on c.supplier_id = s.id where s.status <> 'merged'), '[]'::jsonb)
$$;

create or replace function private.catalog_rows()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with registry_at as (
    select r.id, (row_number() over (order by r.id) - 1)::int as at from public.registries r
  ), document_at as (
    select d.id, (row_number() over (order by d.id) - 1)::int as at
    from public.source_documents d
  )
  select jsonb_build_object(
    'suppliers', private.catalog_suppliers(),
    'registries', coalesce((select jsonb_agg(jsonb_build_array(r.id, r.name,
      r.owner_unit_id, r.status) order by r.id) from public.registries r), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(jsonb_build_array(v.id, r.at, d.at,
      v.valid_from, v.valid_until) order by v.id)
      from public.registry_versions v left join registry_at r on r.id = v.registry_id
      left join document_at d on d.id = v.source_document_id), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(jsonb_build_array(f.id, r.at,
      f.source_text) order by f.id)
      from public.registry_fields f left join registry_at r on r.id = f.registry_id),
      '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_array(c.id, c.name, c.parent_id)
      order by c.id) from public.categories c where c.active), '[]'::jsonb),
    'fieldCategories', coalesce((select jsonb_agg(jsonb_build_array(f.registry_field_id,
      f.category_id) order by f.registry_field_id, f.category_id)
      from public.registry_field_categories f), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_array(u.id, u.name) order by u.id)
      from public.org_units u), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_array(d.id, d.url) order by d.id)
      from public.source_documents d), '[]'::jsonb)
  )
$$;

-- supplier_detail now also returns the supplier's current contacts, under RLS.
create or replace function public.supplier_detail(supplier_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with related as (
    select 'suppliers'::text as table_name, s.id::text as row_id
      from public.suppliers s where s.id = supplier_id
    union all select 'supplier_names', n.id::text
      from public.supplier_names n where n.supplier_id = supplier_detail.supplier_id
    union all select 'supplier_identifiers', i.id::text
      from public.supplier_identifiers i where i.supplier_id = supplier_detail.supplier_id
    union all select 'supplier_contacts', c.id::text
      from public.supplier_contacts c where c.supplier_id = supplier_detail.supplier_id
    union all select 'memberships', m.id::text
      from public.memberships m where m.supplier_id = supplier_detail.supplier_id
  ), discovered as (
    select a.table_name, a.row_id from public.audit_log a
    where private.can_read_all()
      and a.table_name in ('suppliers', 'supplier_names', 'supplier_identifiers',
        'supplier_contacts', 'memberships')
      and (a.changes -> 'supplier_id' ->> 'old' = supplier_id::text
        or a.changes -> 'supplier_id' ->> 'new' = supplier_id::text)
  ), ids as (select * from related union select * from discovered)
  select jsonb_build_object(
    'identifiers', coalesce((select jsonb_agg(to_jsonb(i) order by i.id)
      from public.supplier_identifiers i
      where i.supplier_id = supplier_detail.supplier_id), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind,
      'value', c.value, 'is_valid', c.is_valid, 'source_document_id', c.source_document_id,
      'status', c.status) order by c.id)
      from public.supplier_contacts c
      where c.supplier_id = supplier_detail.supplier_id and c.status = 'current'),
      '[]'::jsonb),
    'audit', case when private.can_read_all() then coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id desc)
      from public.audit_log a where exists (select 1 from ids
        where ids.table_name = a.table_name and ids.row_id = a.row_id)
    ), '[]'::jsonb) else null end
  )
$$;
