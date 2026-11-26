-- Merging two supplier rows that turned out to be one entity. Only a person
-- decides a merge, because published documents carry no company numbers.

create function private.move_supplier_children(source_id uuid, target_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.supplier_names n set supplier_id = target_id
  where n.supplier_id = source_id and not exists (
    select 1 from public.supplier_names t
    where t.supplier_id = target_id and t.normalized_name = n.normalized_name
      and t.kind = n.kind);
  update public.supplier_contacts c set supplier_id = target_id, is_primary = false
  where c.supplier_id = source_id and not exists (
    select 1 from public.supplier_contacts t
    where t.supplier_id = target_id and t.kind = c.kind
      and t.normalized_value = c.normalized_value);
  update public.supplier_identifiers set supplier_id = target_id
  where supplier_id = source_id;
  update public.memberships m set supplier_id = target_id
  where m.supplier_id = source_id and not exists (
    select 1 from public.memberships t
    where t.supplier_id = target_id and t.registry_version_id = m.registry_version_id
      and t.registry_field_id is not distinct from m.registry_field_id);
  update public.memberships set review_status = 'removed',
    note = left(concat_ws(' ', note, '(כפול לאחר מיזוג ספקים)'), 2000)
  where supplier_id = source_id;
  update public.engagement_requests set supplier_id = target_id
  where supplier_id = source_id;
  update public.contracts set supplier_id = target_id where supplier_id = source_id;
  update public.supplier_approaches a set supplier_id = target_id
  where a.supplier_id = source_id and not exists (
    select 1 from public.supplier_approaches t
    where t.supplier_id = target_id and t.request_id = a.request_id);
$$;
revoke all on function private.move_supplier_children(uuid, uuid)
  from public, anon, authenticated;

create function public.merge_suppliers(source_id uuid, target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_name text;
begin
  if not private.is_admin() then
    raise exception 'Only an admin merges suppliers' using errcode = '42501';
  end if;
  if source_id = target_id then
    raise exception 'A supplier cannot be merged into itself' using errcode = '22023';
  end if;
  -- Lock both rows in a fixed order so two concurrent merges cannot deadlock.
  perform 1 from public.suppliers
  where id in (source_id, target_id) and status = 'active'
  order by id
  for update;
  select display_name into source_name from public.suppliers
  where id = source_id and status = 'active';
  if not found or not exists (
    select 1 from public.suppliers where id = target_id and status = 'active'
  ) then
    raise exception 'Both suppliers must exist and be active' using errcode = '22023';
  end if;
  insert into public.supplier_names (supplier_id, name, kind)
  values (target_id, source_name, 'as_published')
  on conflict do nothing;
  perform private.move_supplier_children(source_id, target_id);
  update public.suppliers set status = 'merged', merged_into_id = target_id
  where id = source_id;
end;
$$;
revoke all on function public.merge_suppliers(uuid, uuid) from public, anon;
grant execute on function public.merge_suppliers(uuid, uuid) to authenticated;
