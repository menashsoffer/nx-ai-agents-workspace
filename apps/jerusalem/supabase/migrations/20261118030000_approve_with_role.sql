-- Approving an access request gives the chosen role in the same transaction (screens-spec 6,
-- decision 4), so no user is left approved without the role the manager meant to give.

create function public.approve_profile(
  target_user uuid,
  wanted_role text default 'viewer',
  target_unit uuid default null,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_unit uuid;
  unitless boolean := wanted_role in ('admin', 'auditor');
  role_unit uuid;
begin
  if wanted_role is null
    or wanted_role not in ('viewer', 'editor', 'unit_manager', 'admin', 'auditor') then
    raise exception 'invalid:bad_choice' using errcode = '22023';
  end if;
  select unit_id into request_unit from public.profiles
  where user_id = target_user and status = 'pending'
  for update;
  role_unit := case when unitless then null else coalesce(target_unit, request_unit) end;
  -- Never one's own request. A unit manager approves people of their unit, as viewer or editor
  -- of a unit they manage; everything else is for an admin.
  if not found or target_user = auth.uid() or not (
    private.is_admin() or (
      private.manages_unit(request_unit)
      and wanted_role in ('viewer', 'editor')
      and private.manages_unit(role_unit)
    )
  ) then
    raise exception 'Request not found or not authorized' using errcode = '42501';
  end if;
  if not unitless and role_unit is null then
    raise exception 'invalid:required' using errcode = '22023';
  end if;
  if nullif(btrim(note), '') is not null then
    perform private.raise_rule(private.rule_problem('decision_note', btrim(note)));
  end if;
  update public.profiles
  set status = 'active', reviewed_at = now(), reviewed_by = auth.uid(),
    review_note = nullif(btrim(note), '')
  where user_id = target_user;
  insert into public.role_grants (user_id, role, unit_id)
  values (target_user, wanted_role, role_unit);
end;
$$;
revoke all on function public.approve_profile(uuid, text, uuid, text) from public, anon;
grant execute on function public.approve_profile(uuid, text, uuid, text) to authenticated;
