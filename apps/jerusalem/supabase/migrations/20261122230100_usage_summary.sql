-- What the admin usage dashboard reads: sums per day, screen, action and wizard step over
-- raw rows (last 90 days) and the rolled-up days before them. Admins only.

create function private.usage_rows(from_day date, to_day date, only_role text)
returns table (day date, role text, kind text, screen text, action text, step integer,
  events bigint, visitors bigint, visits bigint, duration_ms bigint)
language sql stable security definer set search_path = '' as $$
  select (e.created_at at time zone 'Asia/Jerusalem')::date, e.role, e.kind, e.screen,
    coalesce(e.action, ''), coalesce(e.step, 0), count(*),
    count(distinct e.visitor_key), count(distinct e.visit_id), coalesce(sum(e.duration_ms), 0)
  from public.usage_events e
  where e.created_at >= from_day::timestamp at time zone 'Asia/Jerusalem'
    and e.created_at < (to_day + 1)::timestamp at time zone 'Asia/Jerusalem'
    and (only_role is null or e.role = only_role)
  group by 1, 2, 3, 4, 5, 6
  union all
  select d.day, d.role, d.kind, d.screen, d.action, d.step, d.events, d.visitors, d.visits,
    d.duration_ms
  from public.usage_daily d
  where d.day between from_day and to_day and (only_role is null or d.role = only_role)
$$;

create function public.usage_summary(from_day date, to_day date, only_role text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = 'PT403';
  end if;
  if from_day is null or to_day is null or from_day > to_day or to_day - from_day > 400 then
    raise exception 'Invalid range' using errcode = '22023';
  end if;
  return (
    with r as (select * from private.usage_rows(from_day, to_day, only_role))
    select jsonb_build_object(
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'role', role,
          'visitors', visitors, 'visits', visits) order by day, role)
        from r where kind = 'visit_start'), '[]'::jsonb),
      'screens', coalesce((select jsonb_agg(jsonb_build_object('screen', screen,
          'views', views, 'exits', exits, 'total_ms', total_ms) order by views desc, screen)
        from (select screen, sum(events) filter (where kind = 'screen_view') views,
            sum(events) filter (where kind = 'visit_end') exits,
            sum(duration_ms) filter (where kind = 'screen_view') total_ms
          from r where kind in ('screen_view', 'visit_end') group by screen) s), '[]'::jsonb),
      'actions', coalesce((select jsonb_agg(jsonb_build_object('screen', screen,
          'action', action, 'count', n) order by n desc, screen, action)
        from (select screen, action, sum(events) n from r where kind = 'action'
          group by screen, action) a), '[]'::jsonb),
      'steps', coalesce((select jsonb_agg(jsonb_build_object('screen', screen, 'step', step,
          'visits', n) order by screen, step)
        from (select screen, step, sum(visits) n from r where kind = 'step'
          group by screen, step) t), '[]'::jsonb),
      'visit_ms', coalesce((select sum(duration_ms) from r where kind = 'visit_end'), 0),
      'ended_visits', coalesce((select sum(events) from r where kind = 'visit_end'), 0)
    )
  );
end $$;
revoke all on function private.usage_rows(date, date, text) from public, anon, authenticated;
revoke all on function public.usage_summary(date, date, text) from public, anon, authenticated;
grant execute on function public.usage_summary(date, date, text) to authenticated;
