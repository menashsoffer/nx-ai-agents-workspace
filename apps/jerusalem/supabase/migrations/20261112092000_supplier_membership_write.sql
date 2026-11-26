-- An unowned registry must not be writable by every editor: has_role(NULL) is
-- deliberately an unscoped role test elsewhere. Admins may manage unowned pools.
-- Keep legacy reads for rollback, but stop all application writes to that table.
alter policy supplier_admin_insert on public.legacy_suppliers with check (false);
alter policy supplier_admin_update on public.legacy_suppliers using (false) with check (false);

alter policy memberships_insert on public.memberships
  with check (
    (select private.is_admin())
    or (private.version_unit(registry_version_id) is not null
      and private.has_role(array['editor', 'unit_manager'], private.version_unit(registry_version_id)))
  );

alter policy memberships_update on public.memberships
  using (
    (select private.is_admin())
    or (private.version_unit(registry_version_id) is not null
      and private.has_role(array['editor', 'unit_manager'], private.version_unit(registry_version_id)))
  )
  with check (
    (select private.is_admin())
    or (private.version_unit(registry_version_id) is not null
      and private.has_role(array['editor', 'unit_manager'], private.version_unit(registry_version_id)))
  );

-- Enforce field-to-registry consistency even for direct API writes.
create function private.guard_membership_field()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.registry_field_id is not null and not exists (
    select 1 from public.registry_versions v
    join public.registry_fields f on f.registry_id = v.registry_id
    where v.id = new.registry_version_id and f.id = new.registry_field_id
  ) then
    raise exception 'Registry version and field do not match' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_membership_field() from public, anon, authenticated;
create trigger guard_membership_field before insert or update of registry_version_id, registry_field_id
  on public.memberships for each row execute function private.guard_membership_field();

-- Supplier and first membership must commit or roll back together. Invoker
-- rights preserve every table grant, RLS policy, verification and audit trigger.
create function public.save_supplier_membership(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  version uuid := nullif(payload ->> 'registry_version_id', '')::uuid;
  field uuid := nullif(payload ->> 'registry_field_id', '')::uuid;
  official_number text := nullif(trim(payload ->> 'identifier'), '');
  identifier_scheme text := nullif(payload ->> 'identifier_scheme', '');
  matching_supplier uuid;
  registry uuid;
  unit uuid;
  contact text;
begin
  if jsonb_typeof(payload) <> 'object' or payload - array[
    'supplier_id', 'display_name', 'entity_kind', 'registry_version_id', 'registry_field_id',
    'registered_from', 'registered_until', 'engagement_started_on', 'identifier',
    'identifier_scheme', 'phone', 'email'
  ] <> '{}'::jsonb then
    raise exception 'Invalid supplier input' using errcode = '22023';
  end if;
  select v.registry_id, r.owner_unit_id into registry, unit
  from public.registry_versions v join public.registries r on r.id = v.registry_id
  where v.id = version;
  if registry is null or field is null or not exists (
    select 1 from public.registry_fields f where f.id = field and f.registry_id = registry
  ) then
    raise exception 'Registry version and field do not match' using errcode = '22023';
  end if;
  if not (select private.is_admin()) and (unit is null
    or not private.has_role(array['editor', 'unit_manager'], unit)) then
    raise exception 'Not permitted in this registry' using errcode = '42501';
  end if;
  if supplier is not null and not exists (
    select 1 from public.suppliers s where s.id = supplier and s.status = 'active'
  ) then
    raise exception 'Supplier is unavailable' using errcode = '22023';
  end if;
  if (official_number is null) <> (identifier_scheme is null)
    or (identifier_scheme is not null and identifier_scheme not in ('company', 'nonprofit', 'vat_dealer')) then
    raise exception 'Invalid identifier' using errcode = '22023';
  end if;
  if official_number is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(official_number, 0));
    if exists (
      select 1 from public.supplier_identifiers i
      where i.value = official_number and i.scheme <> 'personal_id'
        and i.review_status <> 'rejected' and i.supplier_id is distinct from supplier
    ) then
      raise exception 'Identifier belongs to another supplier' using errcode = '23505';
    end if;
    select i.supplier_id into matching_supplier from public.supplier_identifiers i
    where i.value = official_number and i.scheme <> 'personal_id' and i.review_status <> 'rejected'
    limit 1;
  end if;
  if supplier is null then
    insert into public.suppliers (display_name, entity_kind)
    values (trim(payload ->> 'display_name'), coalesce(nullif(payload ->> 'entity_kind', ''), 'unknown'))
    returning id into supplier;
  end if;
  if official_number is not null and matching_supplier is null then
    insert into public.supplier_identifiers (supplier_id, scheme, value)
    values (supplier, identifier_scheme, official_number);
  end if;
  insert into public.memberships (supplier_id, registry_version_id, registry_field_id,
    registered_from, registered_until, engagement_started_on, dates_source)
  values (supplier, version, field, nullif(payload ->> 'registered_from', '')::date,
    nullif(payload ->> 'registered_until', '')::date,
    nullif(payload ->> 'engagement_started_on', '')::date, 'internal_registry');
  foreach contact in array array['phone', 'email'] loop
    if nullif(trim(payload ->> contact), '') is not null then
      insert into public.supplier_contacts (supplier_id, kind, value)
      values (supplier, contact, trim(payload ->> contact)) on conflict do nothing;
    end if;
  end loop;
  return supplier;
end;
$$;
revoke all on function public.save_supplier_membership(jsonb) from public, anon;
grant execute on function public.save_supplier_membership(jsonb) to authenticated;

-- Preserve the previous name and require a second review after changing it.
create function public.rename_supplier(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  new_name text := nullif(trim(payload ->> 'display_name'), '');
  previous_name text;
begin
  if jsonb_typeof(payload) <> 'object' or payload - array['supplier_id', 'display_name'] <> '{}'::jsonb
    or supplier is null or new_name is null then
    raise exception 'Invalid supplier name' using errcode = '22023';
  end if;
  select s.display_name into previous_name from public.suppliers s
    where s.id = supplier and s.status = 'active' for update;
  if previous_name is null then raise exception 'Supplier is unavailable' using errcode = '22023'; end if;
  if previous_name = new_name then return supplier; end if;
  update public.suppliers set display_name = new_name, review_status = 'needs_review' where id = supplier;
  if not found then raise exception 'Not permitted to edit supplier' using errcode = '42501'; end if;
  if previous_name <> new_name then
    insert into public.supplier_names (supplier_id, name, kind)
    values (supplier, previous_name, 'former_name') on conflict do nothing;
  end if;
  return supplier;
end;
$$;
revoke all on function public.rename_supplier(jsonb) from public, anon;
grant execute on function public.rename_supplier(jsonb) to authenticated;

-- A contact value is immutable in the existing grants. Mark the old value as
-- outdated and insert its replacement in the same transaction.
create function public.replace_supplier_contact(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  previous uuid := nullif(payload ->> 'contact_id', '')::uuid;
  contact_kind text := nullif(payload ->> 'kind', '');
  contact_value text := nullif(trim(payload ->> 'value'), '');
  was_primary boolean := false;
  result uuid;
begin
  if jsonb_typeof(payload) <> 'object' or payload - array['supplier_id', 'contact_id', 'kind', 'value'] <> '{}'::jsonb
    or supplier is null or contact_kind not in ('phone', 'email', 'address', 'website', 'contact_person')
    or contact_value is null then
    raise exception 'Invalid contact' using errcode = '22023';
  end if;
  if previous is not null then
    select c.is_primary into was_primary from public.supplier_contacts c
      where c.id = previous and c.supplier_id = supplier and c.kind = contact_kind and c.status = 'current' for update;
    if not found then raise exception 'Contact unavailable or not editable' using errcode = '42501'; end if;
    update public.supplier_contacts set status = 'outdated', is_primary = false
      where id = previous and supplier_id = supplier and kind = contact_kind and status = 'current';
    if not found then raise exception 'Contact unavailable or not editable' using errcode = '42501'; end if;
  end if;
  insert into public.supplier_contacts (supplier_id, kind, value, is_primary)
  values (supplier, contact_kind, contact_value, was_primary) returning id into result;
  return result;
end;
$$;
revoke all on function public.replace_supplier_contact(jsonb) from public, anon;
grant execute on function public.replace_supplier_contact(jsonb) to authenticated;
