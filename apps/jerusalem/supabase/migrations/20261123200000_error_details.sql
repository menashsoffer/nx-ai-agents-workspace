-- What each shown error was (documentation/error-details-spec-he.md sections 3 and 6).
-- Still no actor, session, URL or free text: every new column takes fixed values or a fixed
-- pattern, and the role is read in the database, never taken from the browser.

alter table public.web_telemetry drop constraint web_telemetry_screen_check;
alter table public.web_telemetry
  add constraint web_telemetry_screen_check check (screen ~ '^[a-z][a-z0-9-]{0,39}$'),
  add column cause text check (cause in ('superseded','bad_answer','http','network','render',
    'stale_files','rule','unknown')),
  add column request text check (request ~ '^[a-z][a-z0-9_]{0,62}$'),
  add column role text
    check (role in ('admin','auditor','unit_manager','editor','viewer','supplier','other')),
  add column device text check (device in ('desktop','mobile')),
  add column site_version text check (site_version ~ '^[0-9a-f]{7}$'),
  add constraint web_telemetry_error_cause check (name = 'error' or (cause is null
    and request is null and role is null and device is null and site_version is null));
create index web_telemetry_errors_idx on public.web_telemetry (created_at) where name = 'error';

create or replace function public.record_web_telemetry(events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; caller_role text;
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
      or item - array['name','value','bounded','error_code','boundary','kind','screen','cause',
        'request','device','site_version'] <> '{}'::jsonb
      or jsonb_typeof(item->'name') is distinct from 'string'
      or (item ? 'value' and jsonb_typeof(item->'value') not in ('number','null'))
      or (item ? 'bounded' and jsonb_typeof(item->'bounded') <> 'boolean')
      or exists (
        select 1 from unnest(array['error_code','boundary','kind','screen','cause','request',
          'device','site_version']) as k
        where item ? k and jsonb_typeof(item->k) not in ('string','null')) then
      raise exception 'Invalid telemetry fields' using errcode = '22023';
    end if;
  end loop;
  if not private.take_quota('web_telemetry',120,interval '1 hour') then
    raise exception 'Too many reports' using errcode = 'PT429';
  end if;
  caller_role := private.usage_role();
  insert into public.web_telemetry(name,value,bounded,error_code,boundary,kind,screen,cause,
      request,role,device,site_version)
    select name,value,coalesce(bounded,false),error_code,boundary,kind,screen,cause,request,
      case when name = 'error' then caller_role end,device,site_version
    from jsonb_to_recordset(events) as e(name text,value numeric,bounded boolean,
      error_code text,boundary text,kind text,screen text,cause text,request text,device text,
      site_version text);
end $$;
revoke all on function public.record_web_telemetry(jsonb) from public, anon, authenticated;
grant execute on function public.record_web_telemetry(jsonb) to authenticated;

-- Every error people saw, newest first. Administrators only (decision 5 of the error spec).
-- days null returns all of them; rows are kept without a time limit (decision 2, 22.11).
create function public.error_cases(days integer default 7)
returns table (id bigint, created_at timestamptz, kind text, screen text, cause text,
  request text, error_code text, boundary text, role text, device text, site_version text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if days is not null and days not between 1 and 3650 then
    raise exception 'Invalid range' using errcode = '22023';
  end if;
  return query
    select t.id, t.created_at, coalesce(t.kind, 'system'), coalesce(t.screen, 'other'),
      coalesce(t.cause, 'unknown'), t.request, t.error_code, t.boundary, t.role, t.device,
      t.site_version
    from public.web_telemetry t
    where t.name = 'error'
      and (days is null or t.created_at >= now() - make_interval(days => days))
    order by t.created_at desc, t.id desc
    limit 2000;
end $$;
revoke all on function public.error_cases(integer) from public, anon;
grant execute on function public.error_cases(integer) to authenticated;
