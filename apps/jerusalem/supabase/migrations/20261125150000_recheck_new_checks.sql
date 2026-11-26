-- Stage B of the alignment review (25.11). Menash chose that the registries are asked only
-- about approved numbers. A number approved after its last answer, which came before the new
-- registrar checks, would otherwise wait up to 30 days; the daily re-check now takes it at once.

create or replace function private.recheck_due(i public.supplier_identifiers)
returns boolean language sql stable set search_path = '' as $$
  select i.review_status = 'verified' and i.scheme in ('company', 'nonprofit')
    and (i.checked_at is null or i.checked_at < now() - interval '30 days'
      or not (coalesce(i.registry_details, '{}'::jsonb) ? 'checks'));
$$;

create or replace function public.registry_recheck_queue(batch_size integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'supplier_id', q.supplier_id,
    'scheme', q.scheme, 'value', q.value) order by q.checked_at nulls first, q.id), '[]')
  from (
    select i.id, i.supplier_id, i.scheme, i.value, i.checked_at
    from public.supplier_identifiers i
    join public.suppliers s on s.id = i.supplier_id
    where private.recheck_due(i) and s.status <> 'merged'
    order by i.checked_at nulls first, i.id
    limit least(greatest(batch_size, 1), 100)
  ) q;
$$;

create or replace function public.save_registry_rechecks(results jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  target uuid;
  remaining integer;
begin
  for target in
    select distinct i.supplier_id
    from jsonb_array_elements(coalesce(results, '[]')) r
    join public.supplier_identifiers i on i.id = (r ->> 'id')::uuid
  loop
    perform public.save_registry_checks(target, (
      select jsonb_agg(r) from jsonb_array_elements(results) r
      join public.supplier_identifiers i on i.id = (r ->> 'id')::uuid
      where i.supplier_id = target));
  end loop;
  select count(*) into remaining
  from public.supplier_identifiers i
  join public.suppliers s on s.id = i.supplier_id
  where private.recheck_due(i) and s.status <> 'merged';
  return remaining;
end;
$$;

revoke all on function private.recheck_due(public.supplier_identifiers) from public, anon,
  authenticated;
