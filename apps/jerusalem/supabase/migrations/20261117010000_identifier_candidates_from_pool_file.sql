-- Identifier numbers that a consolidated pool file lists next to a supplier name.
-- They enter as candidates only: the file is not a registrar, and a matching name
-- is not proof of the same supplier. An editor still accepts each one by hand, and
-- a second person verifies the identifier, exactly as for a registrar lookup.

alter table public.identifier_candidates
  drop constraint identifier_candidates_scheme_check,
  add constraint identifier_candidates_scheme_check
    check (scheme in ('company', 'nonprofit', 'vat_dealer', 'personal_id')),
  drop constraint identifier_candidates_source_check,
  add constraint identifier_candidates_source_check
    check (source in ('companies_registrar', 'guidestar', 'pool_file'));

alter table public.supplier_identifiers
  drop constraint supplier_identifiers_source_check,
  add constraint supplier_identifiers_source_check check (source in (
    'companies_registrar', 'nonprofits_registrar', 'guidestar', 'municipality', 'manual',
    'pool_file'
  ));

-- Takes [{ "scheme", "value", "names": [...] }] and stores one pending candidate for
-- every active supplier whose display name or other known name equals one of the
-- names after normalization. Numbers the supplier already has, and candidates that
-- were already decided, are left alone. Returns what matched and what did not, so
-- the person loading the file can review the names that found no supplier.
create function public.import_identifier_candidates(file_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  with entries as (
    select e.ord, e.item ->> 'scheme' as scheme, lpad(e.item ->> 'value', 9, '0') as value,
      e.item -> 'names' as names
    from jsonb_array_elements(file_rows) with ordinality as e(item, ord)
  ),
  matches as (
    select distinct on (s.id, r.scheme, r.value) r.ord, s.id as supplier_id, r.scheme,
      r.value, left(n.name, 300) as searched_name
    from entries r
    cross join lateral jsonb_array_elements_text(r.names) as n(name)
    join public.suppliers s on s.status <> 'merged' and (
      s.normalized_name = private.normalize_name(n.name)
      or exists (
        select 1 from public.supplier_names sn
        where sn.supplier_id = s.id and sn.normalized_name = private.normalize_name(n.name)
      )
    )
    order by s.id, r.scheme, r.value, n.name
  ),
  added as (
    insert into public.identifier_candidates (supplier_id, scheme, value, source,
      searched_name, found_by)
    select m.supplier_id, m.scheme, m.value, 'pool_file', m.searched_name, auth.uid()
    from matches m
    where not exists (
      select 1 from public.supplier_identifiers i
      where i.supplier_id = m.supplier_id and i.scheme = m.scheme and i.value = m.value
        and i.review_status <> 'rejected'
    )
    on conflict (supplier_id, scheme, value) do nothing
    returning 1
  )
  select jsonb_build_object(
    'rows', (select count(*) from entries),
    'matched_rows', (select count(distinct ord) from matches),
    'matched_suppliers', (select count(distinct supplier_id) from matches),
    'inserted', (select count(*) from added),
    'unmatched', coalesce((
      select jsonb_agg(r.names -> 0 order by r.ord) from entries r
      where not exists (select 1 from matches m where m.ord = r.ord)
    ), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

revoke all on function public.import_identifier_candidates(jsonb) from public, anon, authenticated;
grant execute on function public.import_identifier_candidates(jsonb) to authenticated;
