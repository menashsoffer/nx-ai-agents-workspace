-- One MVCC snapshot for access, a version and the catalog. Tuple rows avoid
-- repeating column names and supplier_id across every child record.
create table private.catalog_version (
  singleton boolean primary key default true check (singleton),
  counter bigint not null default 1 check (counter > 0)
);
insert into private.catalog_version default values;
alter table private.catalog_version enable row level security;
revoke all on private.catalog_version from public, anon, authenticated;
grant select, update (counter) on private.catalog_version to authenticated, service_role;
grant usage on schema private to service_role;
create policy catalog_version_read on private.catalog_version for select to authenticated
  using (true);
-- The private schema is not exposed by PostgREST. Even a direct SQL caller
-- cannot set the counter outside a trigger, delete it or add another row.
create policy catalog_version_bump on private.catalog_version for update to authenticated
  using (pg_trigger_depth() > 0) with check (pg_trigger_depth() > 0);

create function private.bump_catalog_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update private.catalog_version set counter = counter + 1 where singleton;
  return null;
end;
$$;
revoke all on function private.bump_catalog_version() from public, anon, authenticated;
grant execute on function private.bump_catalog_version() to authenticated;

do $$
declare
  target text;
begin
  foreach target in array array['suppliers', 'supplier_names', 'memberships',
    'supplier_contacts', 'registries', 'registry_versions', 'registry_fields',
    'categories', 'registry_field_categories', 'org_units', 'source_documents'] loop
    execute format('create trigger catalog_version after insert or update or delete or truncate '
      'on public.%I for each statement execute function private.bump_catalog_version()', target);
  end loop;
end;
$$;

create function private.editable_version_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(v.id), '{}'::uuid[])
  from public.registry_versions v
  join public.registries r on r.id = v.registry_id
  where private.has_role(array['editor', 'unit_manager'], r.owner_unit_id)
$$;
revoke all on function private.editable_version_ids() from public, anon, authenticated;
grant execute on function private.editable_version_ids() to authenticated;

alter policy memberships_read on public.memberships using (
  ((select private.is_member()) and review_status = 'verified')
  or registry_version_id = any ((select private.editable_version_ids())::uuid[])
);

create function private.catalog_suppliers()
returns jsonb language sql stable security invoker set search_path = '' as $$
  -- Each child relation is read once and grouped before nesting. RLS applies to
  -- every relation here, including child rows with different visibility.
  with names as (
    select n.supplier_id, jsonb_agg(jsonb_build_array(
      case when n.name = s.display_name then '0'::jsonb else to_jsonb(n.name) end,
      nullif(n.kind, 'as_published'), n.source_document_id) order by n.id) as rows
    from public.supplier_names n join public.suppliers s on s.id = n.supplier_id
    group by n.supplier_id
  ), memberships as (
    select m.supplier_id, jsonb_agg(jsonb_build_array(m.registry_version_id, m.registry_field_id,
      case when m.name_as_published = s.display_name then '0'::jsonb
        else to_jsonb(m.name_as_published) end, m.source_page, m.registered_from,
      m.registered_until, m.engagement_started_on, nullif(m.dates_source, 'unknown'),
      nullif(m.review_status, 'needs_review'))
      order by m.id) as rows
    from public.memberships m join public.suppliers s on s.id = m.supplier_id
    where m.review_status not in ('rejected', 'removed')
    group by m.supplier_id
  ), contacts as (
    select c.supplier_id, jsonb_agg(jsonb_build_array(c.id, c.kind, c.value, c.is_valid,
      c.source_document_id) order by c.id) as rows
    from public.supplier_contacts c where c.status = 'current' group by c.supplier_id
  )
  select coalesce((select jsonb_agg(jsonb_build_array(s.id, s.display_name,
      nullif(s.entity_kind, 'unknown'), nullif(s.status, 'active'), s.website,
      nullif(s.review_status, 'needs_review'), s.note,
      coalesce(n.rows, '[]'::jsonb), coalesce(m.rows, '[]'::jsonb),
      coalesce(c.rows, '[]'::jsonb)) order by s.id)
      from public.suppliers s left join names n on n.supplier_id = s.id
      left join memberships m on m.supplier_id = s.id
      left join contacts c on c.supplier_id = s.id where s.status <> 'merged'), '[]'::jsonb)
$$;
revoke all on function private.catalog_suppliers() from public, anon, authenticated;
grant execute on function private.catalog_suppliers() to authenticated;

create function private.catalog_rows()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'suppliers', private.catalog_suppliers(),
    'registries', coalesce((select jsonb_agg(jsonb_build_array(r.id, r.name,
      r.owner_unit_id, r.status) order by r.id) from public.registries r), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(jsonb_build_array(v.id, v.registry_id,
      v.source_document_id, v.valid_from, v.valid_until) order by v.id)
      from public.registry_versions v), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(jsonb_build_array(f.id, f.registry_id,
      f.source_text) order by f.id) from public.registry_fields f), '[]'::jsonb),
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
revoke all on function private.catalog_rows() from public, anon, authenticated;
grant execute on function private.catalog_rows() to authenticated;

create function public.catalog_snapshot(known_version text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  access jsonb;
  result jsonb;
  version text;
begin
  select public.my_access() || jsonb_build_object(
    'state', coalesce((select p.status from public.profiles p
      where p.user_id = auth.uid()), 'unregistered'),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('role', g.role, 'unitId', g.unit_id)
      order by g.role, g.unit_id) from public.role_grants g
      where g.user_id = auth.uid() and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > now())), '[]'::jsonb)
  ) into access;
  select c.counter::text || ':' || md5(auth.uid()::text || access::text)
    into version from private.catalog_version c where c.singleton;
  result := jsonb_build_object('user_id', auth.uid(), 'access', access, 'version', version);
  if access ->> 'state' <> 'active' or not (access ->> 'member')::boolean then
    return result;
  end if;
  if known_version = version then
    return result || jsonb_build_object('unchanged', true);
  end if;

  return result || jsonb_build_object('catalog', private.catalog_rows());
end;
$$;
revoke all on function public.catalog_snapshot(text) from public, anon, authenticated;
grant execute on function public.catalog_snapshot(text) to authenticated;

create function public.supplier_detail(supplier_id uuid)
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
    'audit', case when private.can_read_all() then coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id desc)
      from public.audit_log a where exists (select 1 from ids
        where ids.table_name = a.table_name and ids.row_id = a.row_id)
    ), '[]'::jsonb) else null end
  )
$$;
revoke all on function public.supplier_detail(uuid) from public, anon, authenticated;
grant execute on function public.supplier_detail(uuid) to authenticated;
