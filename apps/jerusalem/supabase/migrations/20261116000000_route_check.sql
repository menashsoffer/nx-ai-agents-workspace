-- Server side of the route-check Edge Function: a per-user call quota and one
-- function that authorizes the caller and returns everything the rules engine
-- needs in a single round trip. The engine result itself is written to
-- public.route_checks by the Edge Function with the service role.

-- Fixed-window call counter per user and bucket. Rows are overwritten in place,
-- so the table stays at one row per user and bucket.
create table private.call_quota (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (length(bucket) between 1 and 50),
  window_start timestamptz not null default now(),
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, bucket)
);
revoke all on private.call_quota from public, anon, authenticated;

-- Counts one call and tells whether the caller is still within max_calls per window.
create function private.take_quota(bucket text, max_calls integer, per interval)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.call_quota as q (user_id, bucket, window_start, calls)
  values (auth.uid(), bucket, now(), 1)
  on conflict (user_id, bucket) do update set
    window_start = case when q.window_start + per <= now() then now() else q.window_start end,
    calls = case when q.window_start + per <= now() then 1 else q.calls + 1 end
  returning calls <= max_calls
$$;
revoke all on function private.take_quota(text, integer, interval) from public, anon;
grant execute on function private.take_quota(text, integer, interval) to authenticated;

-- Errors use PostgREST's PTxxx codes, so the HTTP status reaches the Edge Function as is.
create function public.route_check_input(target uuid, check_on date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  req public.engagement_requests;
  limits jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = 'PT401';
  end if;
  select * into req from public.engagement_requests where id = target;
  if not found then
    raise exception 'Engagement request not found' using errcode = 'PT404';
  end if;
  if not private.has_role(array['editor', 'unit_manager'], req.unit_id) then
    raise exception 'Not authorized' using errcode = 'PT403';
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
      'estimated_value', req.estimated_value,
      'value_includes_vat', req.value_includes_vat,
      'requested_exemption', req.requested_exemption,
      'facts', req.facts,
      'subject_key', req.subject_key
    ),
    'thresholds', limits,
    'related', private.related_requests(req, check_on)
  );
end;
$$;

-- Regulation 5: open requests of the same unit with the same subject key in the
-- 90 days up to the check date. Null when the request has no subject key, which
-- tells the engine that the splitting check was not run.
create function private.related_requests(req public.engagement_requests, check_on date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when req.subject_key is null then null else coalesce((
    select jsonb_agg(jsonb_build_object(
      'estimated_value', r.estimated_value,
      'value_includes_vat', r.value_includes_vat
    ))
    from public.engagement_requests r
    where r.unit_id = req.unit_id
      and r.subject_key = req.subject_key
      and r.id <> req.id
      and r.status not in ('cancelled', 'rejected')
      and r.created_at::date between check_on - 90 and check_on
  ), '[]'::jsonb) end
$$;
revoke all on function private.related_requests(public.engagement_requests, date)
  from public, anon;
grant execute on function private.related_requests(public.engagement_requests, date)
  to authenticated;

revoke all on function public.route_check_input(uuid, date) from public, anon;
grant execute on function public.route_check_input(uuid, date) to authenticated;

-- Only the Edge Function writes engine results (see 20261112060100_engagements_access.sql).
grant insert on public.route_checks to service_role;
grant usage on sequence public.route_checks_id_seq to service_role;
