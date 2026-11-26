-- An admin needs nobody's approval (Menash, 19.11): a change an admin asks for is applied at
-- once and recorded as approved by themselves, so the history stays in one table.
-- A pending request an admin already sent is approved the same way.

create or replace function public.request_access_change(
  change_kind text,
  why text,
  wanted_role text default null,
  target_unit uuid default null,
  target_grant uuid default null,
  new_details jsonb default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  request public.access_change_requests;
begin
  if not exists (select 1 from public.profiles where user_id = me and status = 'active') then
    raise exception 'Only an active user may ask for a change' using errcode = '42501';
  end if;
  perform private.raise_rule(private.rule_problem('access_reason', why));
  if change_kind = 'details' then
    perform private.raise_rule(private.details_problem(new_details));
  elsif change_kind = 'remove_role' and not exists (
    select 1 from public.role_grants
    where id = target_grant and user_id = me and revoked_at is null
  ) then
    raise exception 'invalid:bad_choice' using errcode = '22023';
  elsif change_kind in ('add_role', 'move_unit') and target_unit is not null and not exists (
    select 1 from public.org_units where id = target_unit and active
  ) then
    raise exception 'invalid:bad_choice' using errcode = '22023';
  end if;
  insert into public.access_change_requests
    (user_id, kind, role, unit_id, grant_id, details, reason)
  values (
    me, change_kind,
    case when change_kind = 'add_role' then wanted_role end,
    case when change_kind in ('add_role', 'move_unit') then target_unit end,
    case when change_kind = 'remove_role' then target_grant end,
    case when change_kind = 'details' then new_details end,
    trim(why)
  )
  returning * into request;
  if private.is_admin() then
    perform private.apply_access_change(request);
    update public.access_change_requests
    set status = 'approved', decided_at = now(), decided_by = me, updated_at = now()
    where id = request.id;
  end if;
  return request.id;
end;
$$;

-- Requests admins sent before this change: apply and close them as their own approval.
do $$
declare
  request public.access_change_requests;
begin
  for request in
    select r.* from public.access_change_requests r
    where r.status = 'pending' and exists (
      select 1 from public.role_grants g
      where g.user_id = r.user_id and g.role = 'admin' and g.revoked_at is null
    )
    order by r.created_at
  loop
    perform private.apply_access_change(request);
    update public.access_change_requests
    set status = 'approved', decided_at = now(), decided_by = request.user_id, updated_at = now()
    where id = request.id;
  end loop;
end;
$$;
