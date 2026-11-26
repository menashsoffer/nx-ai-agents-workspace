-- Threshold calculator. Regulation 2: each base amount is multiplied by the
-- ratio between the current consumer price index and the base index, and
-- rounded to the nearest 100. The same formula lives in
-- supabase/functions/_shared/procurement/amounts.ts; a test keeps the two equal.
-- The monthly rows themselves come from 20261113000000_threshold_history.sql.

-- Round half to even, to the nearest 100, as the amounts are published.
create function private.indexed_amount(base_amount numeric, index_ratio numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 100 * case
    when q - floor(q) = 0.5 then floor(q) + (floor(q)::bigint % 2)
    else round(q)
  end
  from (select base_amount * index_ratio / 100 as q) v
$$;

-- The amounts for an index given on the 1985 base (base index 175.3).
create function public.calculate_thresholds(index_on_1985_base numeric)
returns table (no_tender_max numeric, zuta4_max numeric, zuta6_max numeric)
language sql
immutable
set search_path = ''
as $$
  select private.indexed_amount(26000, index_on_1985_base / 175.3),
    private.indexed_amount(63500, index_on_1985_base / 175.3),
    private.indexed_amount(127000, index_on_1985_base / 175.3)
  where index_on_1985_base > 0
$$;

-- Stores the calculated amounts for the month that starts on an update day.
create function public.record_threshold(
  index_on_1985_base numeric,
  starts_on date,
  index_source text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Not authorized to record thresholds' using errcode = '42501';
  end if;
  if index_on_1985_base is null or index_on_1985_base <= 0 then
    raise exception 'The index must be positive' using errcode = '22023';
  end if;
  if extract(day from starts_on) <> 16 then
    raise exception 'Thresholds start on the 16th of a month' using errcode = '22023';
  end if;
  insert into public.thresholds (valid_from, valid_until, no_tender_max, zuta4_max,
    zuta6_max, index_value, source, is_official)
  select starts_on, (starts_on + interval '1 month' - interval '1 day')::date,
    c.no_tender_max, c.zuta4_max, c.zuta6_max, index_on_1985_base, index_source, false
  from public.calculate_thresholds(index_on_1985_base) c
  returning id into new_id;
  return new_id;
end
$$;

revoke all on function private.indexed_amount(numeric, numeric) from public, anon;
grant execute on function private.indexed_amount(numeric, numeric) to authenticated;
revoke all on function public.calculate_thresholds(numeric),
  public.record_threshold(numeric, date, text) from public, anon;
grant execute on function public.calculate_thresholds(numeric),
  public.record_threshold(numeric, date, text) to authenticated;

-- How long the stored thresholds still cover. A gap before today counts as
-- not covered, so the site and CI can warn before the engine stops answering.
create view public.threshold_coverage
with (security_invoker = true)
as
select
  (select max(valid_until) from public.thresholds) as covered_until,
  exists (
    select 1 from public.thresholds
    where current_date between valid_from and coalesce(valid_until, current_date)
  ) as covered_today,
  coalesce((select max(valid_until) from public.thresholds) - current_date, 0) as days_left;

revoke all on public.threshold_coverage from public, anon;
grant select on public.threshold_coverage to authenticated;
