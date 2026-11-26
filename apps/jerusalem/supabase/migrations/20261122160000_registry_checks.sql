-- Supplier edit checks, stage 2 (documentation/supplier-edit-checks-spec-he.md, 6.3).
-- The Edge Function supplier-change-check asks the Companies Registrar and GuideStar about
-- the supplier's own numbers and stores the answer on each identifier with the service key.
-- The checks of stage 1 then read the stored name and status, so a browser cannot forge a
-- registry result: the registry columns are no longer writable by signed-in users.

alter table public.supplier_identifiers add column registry_details jsonb
  check (registry_details is null or jsonb_typeof(registry_details) = 'object');

revoke insert (registrar_name, registrar_status, checked_at),
  update (registrar_name, registrar_status, checked_at)
  on public.supplier_identifiers from authenticated;

-- A registry status that means the body no longer works: deleted, wound up, not found.
create function private.registry_inactive(status text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(status ~ 'מחוק|מחיקה|מחוסל|פירוק|פורק|לא פעיל|בוטל|לא נמצא', false);
$$;

-- The numbers the function should ask about: company and nonprofit numbers that were not
-- checked in the last 24 hours. Each call that has something to ask counts toward the same
-- 30 an hour as the identifier search.
create function public.registry_check_input(target uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.suppliers;
  stale jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = 'PT401';
  end if;
  if not private.has_role(array['editor', 'unit_manager']) then
    raise exception 'Not authorized' using errcode = 'PT403';
  end if;
  select * into s from public.suppliers where id = target and status <> 'merged';
  if not found then
    raise exception 'Supplier not found' using errcode = 'PT404';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'scheme', i.scheme,
    'value', i.value) order by i.created_at), '[]') into stale
  from public.supplier_identifiers i
  where i.supplier_id = s.id and i.scheme in ('company', 'nonprofit')
    and i.review_status <> 'rejected'
    and (i.checked_at is null or i.checked_at < now() - interval '24 hours');
  if jsonb_array_length(stale) > 0
    and not private.take_quota('supplier_identifiers', 30, interval '1 hour') then
    raise exception 'Too many lookups' using errcode = 'PT429';
  end if;
  return jsonb_build_object('identifiers', stale);
end;
$$;

-- Stores what the registries answered. Only the function calls it, with the service key.
-- A body that became inactive marks the supplier for review (decision 7): its status stays.
create function public.save_registry_checks(target uuid, results jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  saved integer;
  newly_inactive boolean;
begin
  with answer as (
    select i.id, private.registry_inactive(i.registrar_status) as was_inactive,
      left(nullif(trim(r.name), ''), 300) as name,
      left(case when r.found then nullif(trim(r.status), '') else 'לא נמצא במרשם' end, 100)
        as status,
      case when jsonb_typeof(r.details) = 'object' then r.details end as details
    from jsonb_to_recordset(coalesce(results, '[]'))
      as r (id uuid, found boolean, name text, status text, details jsonb)
    join public.supplier_identifiers i on i.id = r.id
    where r.found is not null and i.supplier_id = target and i.scheme in ('company', 'nonprofit')
  ), changed as (
    update public.supplier_identifiers i set
      registrar_name = coalesce(a.name, i.registrar_name), registrar_status = a.status,
      registry_details = coalesce(a.details, i.registry_details), checked_at = now(),
      updated_at = now()
    from answer a
    where i.id = a.id
    returning private.registry_inactive(a.status) and not a.was_inactive as became_inactive
  )
  select count(*), coalesce(bool_or(became_inactive), false) into saved, newly_inactive
  from changed;
  if newly_inactive then
    update public.suppliers set review_status = 'needs_review', updated_at = now()
    where id = target and review_status <> 'needs_review';
  end if;
  return saved;
end;
$$;

-- Spec 4.2 and 4.5: what the registry said about the supplier's numbers, when it was asked.
create function private.registry_status_check(s public.suppliers)
returns jsonb language sql stable set search_path = '' as $$
  select case
    when bool_or(private.registry_inactive(i.registrar_status)) then
      jsonb_build_array(private.change_check('registry_status', 'yellow', jsonb_build_object(
        'name', min(i.registrar_status) filter (
          where private.registry_inactive(i.registrar_status)))))
    when count(*) > 0 then
      jsonb_build_array(private.change_check('registry_status', 'green',
        jsonb_build_object('name', min(i.registrar_status))))
    else '[]'::jsonb
  end
  from public.supplier_identifiers i
  where i.supplier_id = s.id and i.scheme in ('company', 'nonprofit')
    and i.review_status <> 'rejected' and i.checked_at is not null
    and i.registrar_status is not null;
$$;

create or replace function private.supplier_change_checks(s public.suppliers, change jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select case change ->> 'kind'
    when 'rename' then private.rename_checks(s, trim(change ->> 'value'))
      || private.registry_status_check(s)
    when 'entity_kind' then private.kind_checks(s, change ->> 'value')
      || private.registry_status_check(s)
    else private.contact_checks(s, change ->> 'contact_kind',
      nullif(change ->> 'contact_id', '')::uuid, change ->> 'value')
  end;
$$;

revoke all on function private.registry_inactive(text),
  private.registry_status_check(public.suppliers) from public, anon, authenticated;
revoke all on function public.registry_check_input(uuid), public.save_registry_checks(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.registry_check_input(uuid) to authenticated;
grant execute on function public.save_registry_checks(uuid, jsonb) to service_role;
