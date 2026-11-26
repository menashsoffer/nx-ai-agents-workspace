-- Error handling stage C (documentation/error-handling-spec-he.md section 8).
-- Every error the site shows is counted by kind and screen, still with no actor, session,
-- URL or free text: both new columns take only fixed values. Administrators see a 7-day
-- summary in load control (decision 5: administrators only, not auditors).

alter table public.web_telemetry
  add column kind text check (kind in ('offline','timeout','unavailable','system','session',
    'forbidden','rule','reason','gone','duplicate','rate_limit','unconfirmed')),
  add column screen text check (screen in ('catalog','supplier','categories','identifiers',
    'admin','route-check','engagement','addresses','load-control','users','thresholds','auth',
    'other')),
  add constraint web_telemetry_error_detail check (name = 'error' or (kind is null and screen is null));

-- 'action': an error shown beside a button or a form, not one that replaced a screen.
alter table public.web_telemetry drop constraint web_telemetry_boundary_check;
alter table public.web_telemetry
  add constraint web_telemetry_boundary_check
  check (boundary in ('root','route','bootstrap','action'));

create or replace function public.record_web_telemetry(events jsonb)
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
      or item - array['name','value','bounded','error_code','boundary','kind','screen']
        <> '{}'::jsonb
      or jsonb_typeof(item->'name') is distinct from 'string'
      or (item ? 'value' and jsonb_typeof(item->'value') not in ('number','null'))
      or (item ? 'bounded' and jsonb_typeof(item->'bounded') <> 'boolean')
      or (item ? 'error_code' and jsonb_typeof(item->'error_code') not in ('string','null'))
      or (item ? 'boundary' and jsonb_typeof(item->'boundary') not in ('string','null'))
      or (item ? 'kind' and jsonb_typeof(item->'kind') not in ('string','null'))
      or (item ? 'screen' and jsonb_typeof(item->'screen') not in ('string','null')) then
      raise exception 'Invalid telemetry fields' using errcode = '22023';
    end if;
  end loop;
  if not private.take_quota('web_telemetry',120,interval '1 hour') then
    raise exception 'Too many reports' using errcode = 'PT429';
  end if;
  insert into public.web_telemetry(name,value,bounded,error_code,boundary,kind,screen)
    select name,value,coalesce(bounded,false),error_code,boundary,kind,screen
    from jsonb_to_recordset(events) as e(name text,value numeric,bounded boolean,
      error_code text,boundary text,kind text,screen text);
end $$;
revoke all on function public.record_web_telemetry(jsonb) from public, anon, authenticated;
grant execute on function public.record_web_telemetry(jsonb) to authenticated;

-- Errors of the last 7 days by kind and screen, most frequent first. Administrators only.
create function public.error_summary()
returns table (kind text, screen text, failures bigint, last_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select coalesce(t.kind, 'system'), coalesce(t.screen, 'other'), count(*), max(t.created_at)
    from public.web_telemetry t
    where t.name = 'error' and t.created_at >= now() - interval '7 days'
    group by 1, 2
    order by 3 desc, 4 desc
    limit 50;
end $$;
revoke all on function public.error_summary() from public, anon;
grant execute on function public.error_summary() to authenticated;
