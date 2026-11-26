-- R14: technical measurements have no actor, session, URL, free text or JSON payload.
create table public.web_telemetry (
  id bigint generated always as identity primary key,
  name text not null check (name in ('LCP','INP','CLS','error')),
  value numeric,
  bounded boolean not null default false,
  error_code text check (error_code in ('unexpected','http_401','http_403','http_404','http_429','http_5xx')),
  boundary text check (boundary in ('root','route','bootstrap')),
  -- Project budgets, documentation/react-guide-he.md section 6. Not the generic CWV thresholds.
  within_budget boolean generated always as (
    case name when 'LCP' then value <= 1500 when 'INP' then value <= 200
      when 'CLS' then value <= 0.1 else null end
  ) stored,
  created_at timestamptz not null default now(),
  check ((name = 'error' and value is null and error_code is not null and boundary is not null
      and not bounded)
    or (name <> 'error' and value is not null and value >= 0 and value <= case when name = 'CLS' then 100 else 3600000 end
      and error_code is null and boundary is null))
);
alter table public.web_telemetry enable row level security;
revoke all on public.web_telemetry from public, anon, authenticated;
grant select on public.web_telemetry to authenticated;
create policy telemetry_read on public.web_telemetry for select to authenticated
  using ((select private.can_read_all()));

create function public.record_web_telemetry(events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = 'PT401'; end if;
  if not private.is_member() then raise exception 'Not authorized' using errcode = 'PT403'; end if;
  if jsonb_typeof(events) is distinct from 'array' then
    raise exception 'Expected an array' using errcode = '22023';
  end if;
  if jsonb_array_length(events) not between 1 and 50 then
    raise exception 'Invalid batch size' using errcode = '22023';
  end if;
  for item in select jsonb_array_elements(events) loop
    if jsonb_typeof(item) is distinct from 'object'
      or item - array['name','value','bounded','error_code','boundary'] <> '{}'::jsonb
      or jsonb_typeof(item->'name') is distinct from 'string'
      or (item ? 'value' and jsonb_typeof(item->'value') not in ('number','null'))
      or (item ? 'bounded' and jsonb_typeof(item->'bounded') <> 'boolean')
      or (item ? 'error_code' and jsonb_typeof(item->'error_code') not in ('string','null'))
      or (item ? 'boundary' and jsonb_typeof(item->'boundary') not in ('string','null')) then
      raise exception 'Invalid telemetry fields' using errcode = '22023';
    end if;
  end loop;
  if not private.take_quota('web_telemetry',120,interval '1 hour') then
    raise exception 'Too many reports' using errcode = 'PT429';
  end if;
  insert into public.web_telemetry(name,value,bounded,error_code,boundary)
    select name,value,coalesce(bounded,false),error_code,boundary
    from jsonb_to_recordset(events) as e(name text,value numeric,bounded boolean,
      error_code text,boundary text);
end $$;
revoke all on function public.record_web_telemetry(jsonb) from public, anon, authenticated;
grant execute on function public.record_web_telemetry(jsonb) to authenticated;
