-- The engagement shortlist (documentation/catalog-portal-spec-he.md, stage C). A member can
-- check the route for an amount without saving anything (owner's decision 2, 17.11). Saving
-- a request and recording approaches stays with editors and managers of the unit, through
-- the existing tables and their RLS. A member sees only when a supplier was last approached,
-- never by whom or for what.

-- Same inputs as route_check_input, but from a draft that is never stored. The quota is the
-- same bucket, so a preview cannot be used to get around the hourly limit.
create function public.route_check_preview_input(draft jsonb, check_on date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  limits jsonb;
  exemption text := draft ->> 'requested_exemption';
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = 'PT401';
  end if;
  if not (private.is_member() or private.has_role(array['auditor'])) then
    raise exception 'Not authorized' using errcode = 'PT403';
  end if;
  if jsonb_typeof(draft) is distinct from 'object'
    or jsonb_typeof(draft -> 'estimated_value') is distinct from 'number'
    or (draft ->> 'estimated_value')::numeric not between 0 and 999999999999
    or jsonb_typeof(draft -> 'value_includes_vat') is distinct from 'boolean'
    or (exemption is not null and exemption !~ '^3\([0-9]+א?\)$')
    or jsonb_typeof(coalesce(draft -> 'facts', '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid draft' using errcode = 'PT400';
  end if;
  if not private.take_quota('route_check', 120, interval '1 hour') then
    raise exception 'Too many route checks' using errcode = 'PT429';
  end if;
  select to_jsonb(t) into limits
  from (
    select id, valid_from, valid_until, no_tender_max, zuta4_max, zuta6_max, source, is_official
    from public.thresholds
    where valid_from <= check_on
    order by valid_from desc
    limit 1
  ) t;
  return jsonb_build_object(
    'user_id', auth.uid(),
    'request', jsonb_build_object(
      'estimated_value', (draft ->> 'estimated_value')::numeric,
      'value_includes_vat', (draft ->> 'value_includes_vat')::boolean,
      'requested_exemption', exemption,
      'facts', coalesce(draft -> 'facts', '{}'::jsonb),
      'subject_key', null
    ),
    'thresholds', limits,
    -- A draft has no subject key, so the splitting check is reported as not run.
    'related', null
  );
end;
$$;
revoke all on function public.route_check_preview_input(jsonb, date) from public, anon;
grant execute on function public.route_check_preview_input(jsonb, date) to authenticated;

-- Runs as the caller, so the insert policy decides who may open a request for which unit.
create function public.create_engagement_request(draft jsonb)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.engagement_requests (unit_id, subject, estimated_value,
    value_includes_vat, requested_exemption)
  values ((draft ->> 'unit_id')::uuid, trim(draft ->> 'subject'),
    (draft ->> 'estimated_value')::numeric, (draft ->> 'value_includes_vat')::boolean,
    nullif(draft ->> 'requested_exemption', ''))
  returning id
$$;
revoke all on function public.create_engagement_request(jsonb) from public, anon;
grant execute on function public.create_engagement_request(jsonb) to authenticated;

-- Runs as the caller. One row per supplier; a supplier already approached for the request
-- keeps its first row. Returns how many approaches were added.
create function public.record_supplier_approaches(request uuid, suppliers uuid[], channel text)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with added as (
    insert into public.supplier_approaches (request_id, supplier_id, approached_on, channel)
    select request, s, (now() at time zone 'Asia/Jerusalem')::date, channel
    from unnest(suppliers) s
    on conflict (request_id, supplier_id) do nothing
    returning 1
  )
  select count(*)::integer from added
$$;
revoke all on function public.record_supplier_approaches(uuid, uuid[], text) from public, anon;
grant execute on function public.record_supplier_approaches(uuid, uuid[], text)
  to authenticated;

-- The last approach date per supplier across all units, and nothing else about it.
create function public.last_approaches(suppliers uuid[])
returns table (supplier_id uuid, last_on date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_member() or private.has_role(array['auditor'])) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if cardinality(suppliers) > 50 then
    raise exception 'At most 50 suppliers' using errcode = '22023';
  end if;
  return query
    select a.supplier_id, max(a.approached_on)
    from public.supplier_approaches a
    where a.supplier_id = any (suppliers)
    group by a.supplier_id;
end;
$$;
revoke all on function public.last_approaches(uuid[]) from public, anon;
grant execute on function public.last_approaches(uuid[]) to authenticated;
