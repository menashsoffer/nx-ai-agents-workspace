-- Counters for the admin home (documentation/screens-spec-he.md section 5). Each counter is
-- returned only to someone who may open that screen; a unit manager counts pending sign-ups of
-- their own units only. Counts only: no names, ids or rows leave this function.
create function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  admin boolean := private.is_admin();
  counters jsonb := '{}'::jsonb;
begin
  if admin or private.has_role(array['unit_manager']) then
    counters := counters || jsonb_build_object('users_pending', (
      select count(*) from public.profiles p
      where p.status = 'pending' and (admin or private.manages_unit(p.unit_id))));
  end if;
  if admin or private.has_role(array['editor', 'unit_manager']) then
    counters := counters || jsonb_build_object('identifiers_pending', (
      select count(*) from public.identifier_candidates where status = 'pending'));
  end if;
  if admin then
    counters := counters || jsonb_build_object(
      'categories_pending', (select count(*) from public.category_requests where status = 'pending'),
      'thresholds_pending', (select count(*) from public.threshold_proposals where status = 'pending'),
      'addresses_not_found', (select count(*) from public.address_checks where result = 'not_found'));
  end if;
  return counters;
end
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
