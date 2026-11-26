-- Supplier edit checks, stage 5 (documentation/supplier-edit-checks-spec-he.md, 6.7).
-- Every verified company or nonprofit number is asked again in its registry once 30 days
-- passed since the last answer. The registry-recheck Edge Function runs daily from GitHub
-- Actions, takes a batch from this queue and stores the answers through
-- save_registry_checks, so a body that was deleted or wound up marks its supplier for
-- review (decision 7) and the supplier's status stays as it is.

create function public.registry_recheck_queue(batch_size integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'supplier_id', q.supplier_id,
    'scheme', q.scheme, 'value', q.value) order by q.checked_at nulls first, q.id), '[]')
  from (
    select i.id, i.supplier_id, i.scheme, i.value, i.checked_at
    from public.supplier_identifiers i
    join public.suppliers s on s.id = i.supplier_id
    where i.review_status = 'verified' and i.scheme in ('company', 'nonprofit')
      and s.status <> 'merged'
      and (i.checked_at is null or i.checked_at < now() - interval '30 days')
    order by i.checked_at nulls first, i.id
    limit least(greatest(batch_size, 1), 100)
  ) q;
$$;

-- Stores a batch that spans suppliers: each supplier's answers go through
-- save_registry_checks, which checks that each number is that supplier's own. Returns how
-- many verified numbers still wait for a check.
create function public.save_registry_rechecks(results jsonb)
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
  where i.review_status = 'verified' and i.scheme in ('company', 'nonprofit')
    and s.status <> 'merged'
    and (i.checked_at is null or i.checked_at < now() - interval '30 days');
  return remaining;
end;
$$;

revoke all on function public.registry_recheck_queue(integer),
  public.save_registry_rechecks(jsonb) from public, anon, authenticated;
grant execute on function public.registry_recheck_queue(integer),
  public.save_registry_rechecks(jsonb) to service_role;
