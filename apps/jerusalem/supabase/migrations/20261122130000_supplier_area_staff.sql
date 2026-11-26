-- Staff side of the supplier area (supplier-portal-spec-he.md 6.10): who is linked to a
-- supplier, shown on its page, and the admin's counter of links to check.

-- Everyone linked to one supplier, newest first. Staff and the auditor read it; a supplier
-- account is not a member, so it is refused.
create function public.supplier_area_accounts(target uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_member() or private.can_read_all()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'role', a.role,
      'status', a.status, 'method', a.method, 'created_at', a.created_at,
      'decided_at', a.decided_at, 'decision_note', a.decision_note, 'email', u.email,
      'first_name', p.first_name, 'last_name', p.last_name, 'job_title', p.job_title)
      order by a.created_at desc, a.id)
    from public.supplier_accounts a
    left join auth.users u on u.id = a.user_id
    left join public.portal_people p on p.user_id = a.user_id
    where a.supplier_id = target), '[]'::jsonb);
end;
$$;

revoke all on function public.supplier_area_accounts(uuid) from public, anon;
grant execute on function public.supplier_area_accounts(uuid) to authenticated;

-- Adds supplier_links_pending: links waiting for approval and the week's email matches,
-- the same rows as supplier_link_queue.
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  admin boolean := private.is_admin();
  counters jsonb := '{}'::jsonb;
begin
  if admin or private.has_role(array['unit_manager']) then
    counters := counters || jsonb_build_object('users_pending',
      (select count(*) from public.profiles p
        where p.status = 'pending' and (admin or private.manages_unit(p.unit_id)))
      + (select count(*) from public.access_change_requests r
        where r.status = 'pending' and private.may_decide_change(r)));
  end if;
  if admin then
    counters := counters || jsonb_build_object(
      'identifiers_pending', (select count(*) from public.identifier_candidates
        where status = 'pending'),
      'categories_pending', (select count(*) from public.category_requests where status = 'pending'),
      'thresholds_pending', (select count(*) from public.threshold_proposals where status = 'pending'),
      'addresses_not_found', (select count(*) from public.address_checks where result = 'not_found'),
      'supplier_links_pending', (select count(*) from public.supplier_accounts a
        where a.status = 'pending' or (a.status = 'active' and a.method = 'email_match'
          and a.created_at > now() - interval '7 days')));
  end if;
  return counters;
end
$$;
