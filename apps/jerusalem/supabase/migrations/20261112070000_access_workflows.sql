-- Multi-step changes run as one database function each, so they either complete
-- or roll back together. SECURITY INVOKER keeps the caller under RLS and grants
-- where possible; the definer functions check the caller's role explicitly.

create function public.my_access()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'member', private.is_member(),
    'admin', private.is_admin(),
    'editor', private.has_role(array['editor', 'unit_manager']),
    'manager', private.has_role(array['unit_manager'])
  )
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- Approves or rejects a pending profile and, on approval, grants its first role.
create function public.decide_profile(
  target_user uuid,
  decision text,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_unit uuid;
begin
  if decision is null or decision not in ('active', 'rejected') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  select unit_id into target_unit from public.profiles
  where user_id = target_user and status = 'pending'
  for update;
  if not found or not (private.is_admin() or private.manages_unit(target_unit)) then
    raise exception 'Request not found or not authorized' using errcode = '42501';
  end if;
  update public.profiles
  set status = decision, reviewed_at = now(), reviewed_by = auth.uid(), review_note = note
  where user_id = target_user;
  if decision = 'active' then
    insert into public.role_grants (user_id, role, unit_id)
    values (target_user, 'viewer', target_unit);
  end if;
end;
$$;

-- Admins grant any role. A unit manager grants viewer or editor in their own unit.
create function public.grant_role(
  target_user uuid,
  wanted_role text,
  target_unit uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
begin
  if not (private.is_admin()
    or (wanted_role in ('viewer', 'editor') and private.manages_unit(target_unit))) then
    raise exception 'Not authorized to grant this role' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles where user_id = target_user and status = 'active'
  ) then
    raise exception 'The user has no active profile' using errcode = '22023';
  end if;
  insert into public.role_grants (user_id, role, unit_id)
  values (target_user, wanted_role, target_unit)
  returning id into grant_id;
  return grant_id;
end;
$$;

create function public.revoke_role(grant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.role_grants;
begin
  select * into target from public.role_grants
  where id = grant_id and revoked_at is null
  for update;
  if not found or not (private.is_admin()
    or (target.role in ('viewer', 'editor') and private.manages_unit(target.unit_id))) then
    raise exception 'Grant not found or not authorized' using errcode = '42501';
  end if;
  if target.role = 'admin' and not exists (
    select 1 from public.role_grants
    where role = 'admin' and revoked_at is null and id <> grant_id
  ) then
    raise exception 'The last admin cannot be revoked' using errcode = '22023';
  end if;
  update public.role_grants set revoked_at = now() where id = grant_id;
end;
$$;

create function public.decide_category_request(
  request_id uuid,
  decision text,
  note text,
  category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.category_requests;
  resolved uuid := category_id;
begin
  if not private.is_admin() then
    raise exception 'Only an admin decides category requests' using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved', 'rejected', 'linked') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  select * into request from public.category_requests
  where id = request_id and status = 'pending'
  for update;
  if not found then
    raise exception 'Request not found or already decided' using errcode = '22023';
  end if;
  if decision = 'approved' then
    insert into public.categories (name, description, parent_id)
    values (request.proposed_name, request.description, request.parent_id)
    returning id into resolved;
  elsif decision = 'rejected' then
    resolved := null;
  end if;
  update public.category_requests
  set status = decision, decided_by = auth.uid(), decided_at = now(),
    decision_note = note, resolved_category_id = resolved
  where id = request_id;
  return resolved;
end;
$$;

revoke all on function public.decide_profile(uuid, text, text),
  public.grant_role(uuid, text, uuid), public.revoke_role(uuid),
  public.decide_category_request(uuid, text, text, uuid) from public, anon;
grant execute on function public.decide_profile(uuid, text, text),
  public.grant_role(uuid, text, uuid), public.revoke_role(uuid),
  public.decide_category_request(uuid, text, text, uuid) to authenticated;

-- The audit log and activity events move to database roles as well.
grant select on public.audit_log to authenticated;
create policy audit_log_admin_read on public.audit_log for select to authenticated
  using ((select private.is_admin()));

-- Altered in place rather than dropped, so the policies are never missing.
alter policy activity_admin_read on public.activity_events
  using ((select private.is_admin()));
alter policy activity_insert_own on public.activity_events
  with check (actor_id = (select auth.uid()) and (select private.is_member()));
