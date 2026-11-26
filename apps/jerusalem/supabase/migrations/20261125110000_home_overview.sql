-- The home screen (design approved 25.11): what waits for this user and the state of the
-- registries. A registration's end date is its own date, else its registry version's
-- "valid until" (decision of 25.11: one validity per registry, a supplier's own date wins).

create or replace function private.lapsed_registrations(today date)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('registry_id', x.registry_id, 'name', x.name,
    'count', x.n, 'ended_on', x.ended_on) order by x.n desc, x.name), '[]'::jsonb)
  from (
    select r.id as registry_id, r.name, count(*)::int as n,
      max(coalesce(m.registered_until, v.valid_until)) as ended_on
    from public.memberships m
    join public.registry_versions v on v.id = m.registry_version_id
    join public.registries r on r.id = v.registry_id
    join public.suppliers s on s.id = m.supplier_id and s.status = 'active'
    where r.status = 'active' and m.review_status <> 'rejected'
      and coalesce(m.registered_until, v.valid_until) < today
    group by r.id, r.name
    order by n desc, r.name
    limit 5
  ) x
$$;

revoke all on function private.lapsed_registrations(date) from public, anon, authenticated;

create or replace function public.home_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  admin boolean := private.is_admin();
  result jsonb;
begin
  if not (admin or private.is_member()) then
    raise exception 'Only active members see the overview' using errcode = '42501';
  end if;
  result := jsonb_build_object(
    'active_suppliers', (select count(*) from public.suppliers where status = 'active'),
    'registries', (select count(*) from public.registries where status = 'active'),
    'memberships', (select count(*) from public.memberships where review_status <> 'rejected'),
    'memberships_verified', (select count(*) from public.memberships
      where review_status = 'verified'),
    'suppliers_identified', (select count(distinct i.supplier_id)
      from public.supplier_identifiers i
      join public.suppliers s on s.id = i.supplier_id and s.status = 'active'
      where i.review_status = 'verified'),
    'my_open_requests', (select count(*) from public.engagement_requests e
      where e.status in ('draft', 'submitted', 'approved')
        and (admin or private.in_unit(e.unit_id))),
    'lapsed', private.lapsed_registrations(private.israel_today()));
  if admin then
    result := result || jsonb_build_object(
      'kind_suggestions_pending', (select count(*) from public.kind_suggestions
        where status = 'pending'),
      'registries_without_unit', (select count(*) from public.registries
        where status = 'active' and owner_unit_id is null));
  end if;
  return result;
end
$$;

revoke all on function public.home_overview() from public, anon;
grant execute on function public.home_overview() to authenticated;
