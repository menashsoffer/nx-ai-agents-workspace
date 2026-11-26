-- Auditor ("מבקר"): a global, read-only role. It reads everything an admin can
-- read, including the audit log, and can write nothing. It holds no unit.

alter table public.role_grants drop constraint role_grants_role_check;
alter table public.role_grants add constraint role_grants_role_check
  check (role in ('viewer', 'editor', 'unit_manager', 'admin', 'auditor'));
alter table public.role_grants drop constraint role_grants_check;
alter table public.role_grants add constraint role_grants_check
  check ((role in ('admin', 'auditor')) = (unit_id is null));

create function private.is_auditor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_grants g on g.user_id = p.user_id
    where p.user_id = auth.uid()
      and p.status = 'active'
      and coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
      and g.role = 'auditor'
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
  )
$$;

-- Read access only: admins and auditors.
create function private.can_read_all()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_admin() or private.is_auditor()
$$;

revoke all on function private.is_auditor(), private.can_read_all() from public, anon;
grant execute on function private.is_auditor(), private.can_read_all() to authenticated;

-- Members read shared data; the auditor counts as a member for reading.
create or replace function private.is_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_role(array['viewer', 'editor', 'unit_manager']) or private.is_auditor()
$$;

-- Unit reads always include 'viewer'; unit writes never do. So the auditor
-- passes every unit read and no unit write.
create or replace function private.in_unit(target_unit uuid, wanted text[] default array[
  'viewer', 'editor', 'unit_manager'
])
returns boolean
language sql
stable
set search_path = ''
as $$
  select (target_unit is not null and private.has_role(wanted, target_unit))
    or ('viewer' = any (wanted) and private.is_auditor())
$$;

-- Admin-only reads become admin-or-auditor reads. Writes are unchanged.
alter policy activity_admin_read on public.activity_events
  using ((select private.can_read_all()));
alter policy audit_log_admin_read on public.audit_log
  using ((select private.can_read_all()));
alter policy categories_read on public.categories
  using (((select private.is_member()) and active) or (select private.can_read_all()));
alter policy category_requests_read on public.category_requests
  using (created_by = (select auth.uid()) or (select private.can_read_all()));
alter policy org_units_read on public.org_units
  using ((active and verified) or (select private.can_read_all()));
alter policy profiles_read on public.profiles
  using (
    user_id = (select auth.uid())
    or (select private.can_read_all())
    or private.manages_unit(unit_id)
  );
alter policy role_grants_read on public.role_grants
  using (
    user_id = (select auth.uid())
    or (select private.can_read_all())
    or private.manages_unit(unit_id)
  );
