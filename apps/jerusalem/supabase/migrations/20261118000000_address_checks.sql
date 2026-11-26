-- Supplier page spec, section 4.6: every current supplier address is checked once on a
-- map. The address-check Edge Function reads the queue, asks OpenStreetMap (Nominatim)
-- one address per second and saves the answer here. An address that the map does not
-- find stays visible, with a note, and an admin sees it in the "addresses to check" list.
-- A check belongs to one text: when the address changes it is checked again.
-- Addresses of private persons are never sent to the map service.

create table public.address_checks (
  contact_id uuid primary key references public.supplier_contacts (id) on delete cascade,
  checked_value text not null check (length(checked_value) between 1 and 500),
  result text not null check (result in ('found', 'approximate', 'not_found', 'failed')),
  map_label text check (map_label is null or length(map_label) <= 500),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  checked_at timestamptz not null default now()
);

alter table public.address_checks enable row level security;
revoke all on public.address_checks from public, anon, authenticated;
grant select on public.address_checks to authenticated;
-- Readable exactly where the address itself is readable.
create policy address_checks_read on public.address_checks for select to authenticated
  using (exists (select 1 from public.supplier_contacts c where c.id = contact_id));

-- Addresses that still need a check: never checked, changed since, or a failed check
-- older than a day. Unchecked addresses come first.
create view private.address_check_backlog as
  select c.id as contact_id, c.value, a.contact_id is not null as rechecked, c.updated_at
  from public.supplier_contacts c
  join public.suppliers s on s.id = c.supplier_id
  left join public.address_checks a on a.contact_id = c.id
  where c.kind = 'address' and c.status = 'current' and s.entity_kind <> 'individual'
    and (a.contact_id is null or a.checked_value <> c.value
      or (a.result = 'failed' and a.checked_at < now() - interval '1 day'));
revoke all on private.address_check_backlog from public, anon, authenticated;

create function public.address_check_queue(batch_size integer)
returns table (contact_id uuid, value text)
language sql stable security definer set search_path = '' as $$
  select b.contact_id, b.value from private.address_check_backlog b
  order by b.rechecked, b.updated_at desc, b.contact_id
  limit least(greatest(batch_size, 1), 100)
$$;

-- Saves one batch of answers and returns how many addresses still wait. An answer for
-- a text that is no longer the contact's current value is ignored.
create function public.save_address_checks(results jsonb)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
begin
  if jsonb_typeof(results) <> 'array' then
    raise exception 'Expected an array of results' using errcode = '22023';
  end if;
  insert into public.address_checks as a
    (contact_id, checked_value, result, map_label, latitude, longitude)
  select c.id, c.value, r ->> 'result', left(r ->> 'map_label', 500),
    (r ->> 'latitude')::numeric, (r ->> 'longitude')::numeric
  from jsonb_array_elements(results) r
  join public.supplier_contacts c
    on c.id = (r ->> 'contact_id')::uuid and c.value = r ->> 'value' and c.kind = 'address'
  on conflict (contact_id) do update set checked_value = excluded.checked_value,
    result = excluded.result, map_label = excluded.map_label,
    latitude = excluded.latitude, longitude = excluded.longitude, checked_at = now();
  return (select count(*) from private.address_check_backlog)::integer;
end
$$;

revoke all on function public.address_check_queue(integer), public.save_address_checks(jsonb)
  from public, anon, authenticated;
grant execute on function public.address_check_queue(integer), public.save_address_checks(jsonb)
  to service_role;

-- The admin list: addresses that the map did not find, or found only as a town, with
-- counts for the whole registry.
create function public.addresses_to_check()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorized to list addresses' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
      'found', count(*) filter (where a.result = 'found' and a.checked_value = c.value),
      'approximate', count(*) filter (where a.result = 'approximate' and a.checked_value = c.value),
      'not_found', count(*) filter (where a.result = 'not_found' and a.checked_value = c.value),
      'waiting', count(*) filter (where a.contact_id is null or a.checked_value <> c.value
        or a.result = 'failed'))
      from public.supplier_contacts c
      left join public.address_checks a on a.contact_id = c.id
      where c.kind = 'address' and c.status = 'current'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('contact_id', c.id,
        'supplier_id', s.id, 'supplier_name', s.display_name, 'value', c.value,
        'result', a.result, 'map_label', a.map_label, 'checked_at', a.checked_at)
        order by a.result desc, s.display_name)
      from public.address_checks a
      join public.supplier_contacts c on c.id = a.contact_id and a.checked_value = c.value
      join public.suppliers s on s.id = c.supplier_id
      where c.status = 'current' and a.result in ('approximate', 'not_found')), '[]'::jsonb)
  );
end
$$;
revoke all on function public.addresses_to_check() from public, anon;
grant execute on function public.addresses_to_check() to authenticated;

-- The supplier page shows the map answer next to each address (null until checked).
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
    where private.is_admin()
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
      'status', c.status, 'map', (select jsonb_build_object('result', a.result,
        'label', a.map_label) from public.address_checks a
        where a.contact_id = c.id and a.checked_value = c.value)) order by c.id)
      from public.supplier_contacts c
      where c.supplier_id = supplier_detail.supplier_id and c.status = 'current'),
      '[]'::jsonb),
    'audit', case when private.is_admin() then coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id desc)
      from public.audit_log a where exists (select 1 from ids
        where ids.table_name = a.table_name and ids.row_id = a.row_id)
    ), '[]'::jsonb) else null end
  )
$$;
