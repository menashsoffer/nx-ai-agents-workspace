-- Usage analytics for the admin dashboard (documentation/usage-analytics-spec-he.md).
-- Rows carry a role, never a user id. Distinct people are counted by a key that hashes the
-- user with a salt that exists for one day only, so a key cannot be traced back afterwards.

create table private.usage_salts (
  day date primary key,
  salt text not null default gen_random_uuid()::text
);
revoke all on private.usage_salts from public, anon, authenticated;

create table public.usage_events (
  id bigint generated always as identity primary key,
  visit_id uuid not null,
  visitor_key text not null check (visitor_key ~ '^[0-9a-f]{64}$'),
  role text not null
    check (role in ('admin', 'auditor', 'unit_manager', 'editor', 'viewer', 'supplier', 'other')),
  kind text not null check (kind in ('visit_start', 'screen_view', 'action', 'step', 'visit_end')),
  screen text not null check (screen ~ '^[a-z][a-z0-9-]{0,39}$'),
  action text check (action ~ '^[a-z][a-z0-9_.-]{0,59}$'),
  step integer check (step between 1 and 20),
  duration_ms integer check (duration_ms between 0 and 86400000),
  device text not null check (device in ('desktop', 'mobile')),
  created_at timestamptz not null default now(),
  check ((kind = 'action') = (action is not null)),
  check ((kind = 'step') = (step is not null)),
  check (kind in ('screen_view', 'visit_end') or duration_ms is null)
);
create index usage_events_created_idx on public.usage_events (created_at);
alter table public.usage_events enable row level security;
revoke all on public.usage_events from public, anon, authenticated;
-- No policies: the table is read only through usage_summary and written only by
-- record_usage_events, both security definer.

-- Days older than the raw retention, summed. Kept without a time limit.
create table public.usage_daily (
  day date not null,
  role text not null,
  kind text not null,
  screen text not null,
  action text not null default '',
  step integer not null default 0,
  events integer not null check (events >= 0),
  visitors integer not null check (visitors >= 0),
  visits integer not null check (visits >= 0),
  duration_ms bigint not null default 0 check (duration_ms >= 0),
  primary key (day, role, kind, screen, action, step)
);
alter table public.usage_daily enable row level security;
revoke all on public.usage_daily from public, anon, authenticated;

-- The caller's strongest role. Not taken from the browser.
create function private.usage_role()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when private.is_admin() then 'admin'
    when private.is_auditor() then 'auditor'
    when private.has_role(array['unit_manager']) then 'unit_manager'
    when private.has_role(array['editor']) then 'editor'
    when private.has_role(array['viewer']) then 'viewer'
    when exists (select 1 from private.my_supplier_ids()) then 'supplier'
    else 'other'
  end
$$;

create function private.usage_visitor_key()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Jerusalem')::date; s text;
begin
  insert into private.usage_salts (day) values (today) on conflict (day) do nothing;
  delete from private.usage_salts where day < today - 1;
  select salt into s from private.usage_salts where day = today;
  return encode(sha256(convert_to(auth.uid()::text || ':' || s, 'UTF8')), 'hex');
end $$;

-- Moves raw days past the retention into usage_daily, then deletes them.
create function private.roll_up_usage(keep interval default interval '90 days')
returns void language plpgsql volatile security definer set search_path = '' as $$
declare cutoff date := (now() at time zone 'Asia/Jerusalem')::date - keep;
begin
  if not exists (select 1 from public.usage_events
      where created_at < cutoff::timestamp at time zone 'Asia/Jerusalem') then
    return;
  end if;
  insert into public.usage_daily as d
    (day, role, kind, screen, action, step, events, visitors, visits, duration_ms)
  select (created_at at time zone 'Asia/Jerusalem')::date, role, kind, screen,
    coalesce(action, ''), coalesce(step, 0), count(*), count(distinct visitor_key),
    count(distinct visit_id), coalesce(sum(duration_ms), 0)
  from public.usage_events
  where created_at < cutoff::timestamp at time zone 'Asia/Jerusalem'
  group by 1, 2, 3, 4, 5, 6
  on conflict (day, role, kind, screen, action, step) do update set
    events = d.events + excluded.events, visitors = d.visitors + excluded.visitors,
    visits = d.visits + excluded.visits, duration_ms = d.duration_ms + excluded.duration_ms;
  delete from public.usage_events
  where created_at < cutoff::timestamp at time zone 'Asia/Jerusalem';
end $$;

create function private.check_usage_batch(events jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(events) is distinct from 'array'
    or jsonb_array_length(events) not between 1 and 50 then
    raise exception 'Invalid batch' using errcode = '22023';
  end if;
  for item in select jsonb_array_elements(events) loop
    if jsonb_typeof(item) is distinct from 'object'
      or item - array['visit_id','kind','screen','action','step','duration_ms','device']
        <> '{}'::jsonb then
      raise exception 'Invalid usage fields' using errcode = '22023';
    end if;
  end loop;
end $$;

create function public.record_usage_events(events jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller_role text; key text;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Sign in required' using errcode = 'PT401';
  end if;
  perform private.check_usage_batch(events);
  if not private.take_quota('usage_events', 120, interval '1 hour') then
    raise exception 'Too many reports' using errcode = 'PT429';
  end if;
  caller_role := private.usage_role();
  key := private.usage_visitor_key();
  insert into public.usage_events
    (visit_id, visitor_key, role, kind, screen, action, step, duration_ms, device)
  select e.visit_id, key, caller_role, e.kind, e.screen, e.action, e.step, e.duration_ms,
    e.device
  from jsonb_to_recordset(events) as e(visit_id uuid, kind text, screen text, action text,
    step integer, duration_ms integer, device text);
  perform private.roll_up_usage();
end $$;
revoke all on function public.record_usage_events(jsonb) from public, anon, authenticated;
grant execute on function public.record_usage_events(jsonb) to authenticated;

revoke all on function private.usage_role(), private.usage_visitor_key(),
  private.roll_up_usage(interval), private.check_usage_batch(jsonb)
  from public, anon, authenticated;
