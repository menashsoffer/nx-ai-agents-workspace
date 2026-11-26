-- DRAFT: isolated test only. Do not apply to production before the RLS test plan
-- and an explicit bootstrap and rollback review have been completed.
-- All names are new and deliberately distinct from the existing suppliers table.

begin;

create schema supplier_directory_private;
revoke all on schema supplier_directory_private from public, anon, authenticated;

create table public.supplier_directory_units (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  kind text not null check (kind in ('administration', 'department')),
  parent_id uuid references public.supplier_directory_units(id),
  source_url text,
  verified boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'administration' and parent_id is null)
      or (kind = 'department' and parent_id is not null and parent_id <> id))
);

create table public.supplier_directory_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  email text default nullif((auth.jwt() ->> 'email'), '') check (email is null or length(email) <= 320),
  job_title text not null check (length(trim(job_title)) between 1 and 200),
  phone text check (length(phone) <= 80),
  unit_id uuid not null references public.supplier_directory_units(id),
  purpose text not null check (length(trim(purpose)) between 5 and 1000),
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'blocked')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text check (length(review_note) <= 2000),
  check ((status = 'pending' and reviewed_at is null and reviewed_by is null)
      or (status <> 'pending' and reviewed_at is not null and reviewed_by is not null)),
  check (status <> 'rejected' or length(trim(coalesce(review_note, ''))) >= 2)
);

create table public.supplier_directory_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor', 'department_manager', 'admin')),
  unit_id uuid references public.supplier_directory_units(id),
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  check ((role = 'admin' and unit_id is null) or (role <> 'admin' and unit_id is not null)),
  check (expires_at is null or expires_at > granted_at),
  check (revoked_at is null or revoked_at >= granted_at)
);
create index supplier_directory_roles_user_idx on public.supplier_directory_roles(user_id);
create unique index supplier_directory_roles_active_admin_idx
  on public.supplier_directory_roles(user_id, role) where unit_id is null and revoked_at is null;
create unique index supplier_directory_roles_active_unit_idx
  on public.supplier_directory_roles(user_id, role, unit_id) where unit_id is not null and revoked_at is null;

create table public.supplier_directory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  description text check (length(description) <= 2000),
  parent_id uuid references public.supplier_directory_categories(id),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create unique index supplier_directory_category_root_name_idx
  on public.supplier_directory_categories (lower(trim(name))) where parent_id is null;
create unique index supplier_directory_category_child_name_idx
  on public.supplier_directory_categories (parent_id, lower(trim(name))) where parent_id is not null;

create table public.supplier_directory_category_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  proposed_name text not null check (length(trim(proposed_name)) between 2 and 200),
  description text not null check (length(trim(description)) between 5 and 2000),
  parent_id uuid references public.supplier_directory_categories(id),
  source_reference text check (length(source_reference) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'linked')),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 2000),
  resolved_category_id uuid references public.supplier_directory_categories(id),
  check ((status = 'pending' and decided_by is null and decided_at is null
          and decision_note is null and resolved_category_id is null)
      or (status = 'rejected' and decided_by is not null and decided_at is not null
          and length(trim(coalesce(decision_note, ''))) >= 2 and resolved_category_id is null)
      or (status in ('approved', 'linked') and decided_by is not null and decided_at is not null
          and length(trim(coalesce(decision_note, ''))) >= 2 and resolved_category_id is not null))
);
create index supplier_directory_category_requests_requester_idx
  on public.supplier_directory_category_requests(requested_by);

create table public.supplier_directory_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE')),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);
create index supplier_directory_audit_entity_idx on public.supplier_directory_audit(entity_type, entity_id);

alter table public.supplier_directory_units enable row level security;
alter table public.supplier_directory_profiles enable row level security;
alter table public.supplier_directory_roles enable row level security;
alter table public.supplier_directory_categories enable row level security;
alter table public.supplier_directory_category_requests enable row level security;
alter table public.supplier_directory_audit enable row level security;

-- The owner of these narrowly scoped functions must bypass RLS for the roles
-- and profiles tables. They are defined with a fixed empty search_path.
create function supplier_directory_private.active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supplier_directory_profiles p
    join public.supplier_directory_roles r on r.user_id = p.user_id
    where p.user_id = (select auth.uid()) and p.status = 'active'
      and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true'
      and r.granted_at <= now() and r.revoked_at is null and (r.expires_at is null or r.expires_at > now())
      and (r.role = 'admin' or exists (
        select 1 from public.supplier_directory_units u
        join public.supplier_directory_units parent on parent.id = u.parent_id
        where u.id = r.unit_id and u.kind = 'department' and u.active and u.verified
          and parent.kind = 'administration' and parent.active and parent.verified))
  );
$$;
create function supplier_directory_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supplier_directory_profiles p
    join public.supplier_directory_roles r on r.user_id = p.user_id
    where p.user_id = (select auth.uid()) and p.status = 'active' and r.role = 'admin'
      and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true'
      and r.granted_at <= now() and r.revoked_at is null and (r.expires_at is null or r.expires_at > now())
  );
$$;
create function supplier_directory_private.manages_unit(target_unit uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supplier_directory_profiles p
    join public.supplier_directory_roles r on r.user_id = p.user_id
    join public.supplier_directory_units u on u.id = r.unit_id
    join public.supplier_directory_units parent on parent.id = u.parent_id
    where p.user_id = (select auth.uid()) and p.status = 'active'
      and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true'
      and r.role = 'department_manager' and r.unit_id = target_unit
      and r.granted_at <= now() and r.revoked_at is null and (r.expires_at is null or r.expires_at > now())
      and u.kind = 'department' and u.active and u.verified
      and parent.kind = 'administration' and parent.active and parent.verified
  );
$$;
revoke all on function supplier_directory_private.active_user() from public, anon, authenticated;
revoke all on function supplier_directory_private.is_admin() from public, anon, authenticated;
revoke all on function supplier_directory_private.manages_unit(uuid) from public, anon, authenticated;
grant usage on schema supplier_directory_private to authenticated;
grant execute on function supplier_directory_private.active_user() to authenticated;
grant execute on function supplier_directory_private.is_admin() to authenticated;
grant execute on function supplier_directory_private.manages_unit(uuid) to authenticated;

revoke all on public.supplier_directory_units, public.supplier_directory_profiles,
  public.supplier_directory_roles, public.supplier_directory_categories,
  public.supplier_directory_category_requests, public.supplier_directory_audit from public, anon, authenticated;

grant select on public.supplier_directory_units to authenticated;
grant insert (name, kind, parent_id, source_url, verified, active),
  update (name, kind, parent_id, source_url, verified, active) on public.supplier_directory_units to authenticated;
grant select on public.supplier_directory_profiles to authenticated;
grant insert (user_id, first_name, last_name, job_title, phone, unit_id, purpose)
  on public.supplier_directory_profiles to authenticated;
grant update (status, reviewed_at, reviewed_by, review_note) on public.supplier_directory_profiles to authenticated;
grant select on public.supplier_directory_roles to authenticated;
grant insert (user_id, role, unit_id, granted_by, expires_at), update (revoked_at, expires_at)
  on public.supplier_directory_roles to authenticated;
grant select on public.supplier_directory_categories to authenticated;
grant insert (name, description, parent_id, active, created_by), update (name, description, parent_id, active)
  on public.supplier_directory_categories to authenticated;
grant select on public.supplier_directory_category_requests to authenticated;
grant insert (requested_by, proposed_name, description, parent_id, source_reference)
  on public.supplier_directory_category_requests to authenticated;
grant update (status, decided_by, decided_at, decision_note, resolved_category_id)
  on public.supplier_directory_category_requests to authenticated;
grant select on public.supplier_directory_audit to authenticated;

create policy directory_units_read on public.supplier_directory_units for select to authenticated
  using ((active and verified) or (select supplier_directory_private.is_admin()));
create policy directory_units_admin_insert on public.supplier_directory_units for insert to authenticated
  with check ((select supplier_directory_private.is_admin()));
create policy directory_units_admin_update on public.supplier_directory_units for update to authenticated
  using ((select supplier_directory_private.is_admin())) with check ((select supplier_directory_private.is_admin()));

create policy directory_profiles_read on public.supplier_directory_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select supplier_directory_private.is_admin())
    or supplier_directory_private.manages_unit(unit_id));
create policy directory_profiles_signup on public.supplier_directory_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending'
    and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true'
    and email is not null and email = ((select auth.jwt()) ->> 'email')
    and exists (select 1 from public.supplier_directory_units u
      join public.supplier_directory_units parent on parent.id = u.parent_id
      where u.id = supplier_directory_profiles.unit_id and u.kind = 'department' and u.active and u.verified
        and parent.kind = 'administration' and parent.active and parent.verified));
create policy directory_profiles_admin_update on public.supplier_directory_profiles for update to authenticated
  using ((select supplier_directory_private.is_admin()))
  with check ((select supplier_directory_private.is_admin()) and reviewed_by = (select auth.uid()));
create policy directory_profiles_manager_decide on public.supplier_directory_profiles for update to authenticated
  using (status = 'pending' and supplier_directory_private.manages_unit(unit_id))
  with check (status in ('active', 'rejected') and reviewed_by = (select auth.uid())
    and supplier_directory_private.manages_unit(unit_id));

create policy directory_roles_admin_read on public.supplier_directory_roles for select to authenticated
  using ((select supplier_directory_private.is_admin()) or supplier_directory_private.manages_unit(unit_id));
create policy directory_roles_admin_insert on public.supplier_directory_roles for insert to authenticated
  with check (granted_by = (select auth.uid()) and (
    (select supplier_directory_private.is_admin())
    or (role = 'viewer' and supplier_directory_private.manages_unit(unit_id)
      and exists (select 1 from public.supplier_directory_profiles p
        where p.user_id = supplier_directory_roles.user_id
          and p.unit_id = supplier_directory_roles.unit_id and p.status = 'active'))));
create policy directory_roles_admin_update on public.supplier_directory_roles for update to authenticated
  using ((select supplier_directory_private.is_admin())) with check ((select supplier_directory_private.is_admin()));

create policy directory_categories_read on public.supplier_directory_categories for select to authenticated
  using (((select supplier_directory_private.active_user()) and active) or (select supplier_directory_private.is_admin()));
create policy directory_categories_admin_insert on public.supplier_directory_categories for insert to authenticated
  with check ((select supplier_directory_private.is_admin()) and created_by = (select auth.uid()));
create policy directory_categories_admin_update on public.supplier_directory_categories for update to authenticated
  using ((select supplier_directory_private.is_admin())) with check ((select supplier_directory_private.is_admin()));

create policy directory_category_requests_read on public.supplier_directory_category_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select supplier_directory_private.is_admin()));
create policy directory_category_requests_insert on public.supplier_directory_category_requests for insert to authenticated
  with check ((select supplier_directory_private.active_user()) and requested_by = (select auth.uid()) and status = 'pending');
create policy directory_category_requests_decide on public.supplier_directory_category_requests for update to authenticated
  using ((select supplier_directory_private.is_admin()) and status = 'pending')
  with check ((select supplier_directory_private.is_admin()) and decided_by = (select auth.uid()));

create policy directory_audit_admin_read on public.supplier_directory_audit for select to authenticated
  using ((select supplier_directory_private.is_admin()));

-- This is presentation metadata only. Table policies remain authoritative.
-- The function returns no identities or unit membership information.
create function public.supplier_directory_my_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'active', supplier_directory_private.active_user(),
    'admin', supplier_directory_private.is_admin(),
    'manage_profiles', supplier_directory_private.is_admin() or exists (
      select 1 from public.supplier_directory_roles r
      where r.user_id = (select auth.uid()) and r.role = 'department_manager'
        and supplier_directory_private.manages_unit(r.unit_id)
    )
  );
$$;
revoke all on function public.supplier_directory_my_access() from public, anon, authenticated;
grant execute on function public.supplier_directory_my_access() to authenticated;

-- Category hierarchy is deliberately limited to one parent and one child level.
-- Lock the parent row while checking to prevent concurrent reciprocal moves.
create function supplier_directory_private.check_category_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_parent uuid;
begin
  if new.parent_id is not null then
    select parent_id into parent_parent from public.supplier_directory_categories
      where id = new.parent_id for update;
    if not found or parent_parent is not null then
      raise exception 'Category parent must be an existing top-level category';
    end if;
    if exists (select 1 from public.supplier_directory_categories where parent_id = new.id) then
      raise exception 'A category with children cannot become a child';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function supplier_directory_private.check_category_parent() from public, anon, authenticated;
create trigger directory_category_parent_guard before insert or update of parent_id
  on public.supplier_directory_categories for each row execute function supplier_directory_private.check_category_parent();

create function supplier_directory_private.check_unit_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_kind text;
begin
  if new.kind = 'department' then
    select kind into parent_kind from public.supplier_directory_units where id = new.parent_id for update;
    if not found or parent_kind <> 'administration' then
      raise exception 'Department parent must be an administration';
    end if;
    if exists (select 1 from public.supplier_directory_units where parent_id = new.id) then
      raise exception 'A unit with children cannot become a department';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function supplier_directory_private.check_unit_parent() from public, anon, authenticated;
create trigger directory_unit_parent_guard before insert or update of parent_id, kind
  on public.supplier_directory_units for each row execute function supplier_directory_private.check_unit_parent();

create function supplier_directory_private.prevent_role_reactivation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'Create a new role grant instead of reactivating a revoked one';
  end if;
  return new;
end;
$$;
revoke all on function supplier_directory_private.prevent_role_reactivation() from public, anon, authenticated;
create trigger directory_role_no_reactivation before update on public.supplier_directory_roles
  for each row execute function supplier_directory_private.prevent_role_reactivation();

-- Keep an immutable, deliberately minimal history. Full form contents,
-- contact details and user search terms are not copied into this log.
create function supplier_directory_private.record_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  before_json jsonb;
  after_json jsonb;
  record_id uuid;
begin
  after_json := to_jsonb(new);
  if tg_op = 'UPDATE' then before_json := to_jsonb(old); end if;
  if tg_table_name = 'supplier_directory_profiles' then
    record_id := (after_json ->> 'user_id')::uuid;
    before_json := case when before_json is null then null else jsonb_build_object('status', before_json -> 'status', 'unit_id', before_json -> 'unit_id') end;
    after_json := jsonb_build_object('status', after_json -> 'status', 'unit_id', after_json -> 'unit_id');
  elsif tg_table_name = 'supplier_directory_roles' then
    record_id := (after_json ->> 'id')::uuid;
    before_json := case when before_json is null then null else jsonb_build_object('user_id', before_json -> 'user_id', 'role', before_json -> 'role', 'unit_id', before_json -> 'unit_id', 'revoked_at', before_json -> 'revoked_at', 'expires_at', before_json -> 'expires_at') end;
    after_json := jsonb_build_object('user_id', after_json -> 'user_id', 'role', after_json -> 'role', 'unit_id', after_json -> 'unit_id', 'revoked_at', after_json -> 'revoked_at', 'expires_at', after_json -> 'expires_at');
  elsif tg_table_name = 'supplier_directory_category_requests' then
    record_id := (after_json ->> 'id')::uuid;
    before_json := case when before_json is null then null else jsonb_build_object('status', before_json -> 'status', 'resolved_category_id', before_json -> 'resolved_category_id') end;
    after_json := jsonb_build_object('status', after_json -> 'status', 'resolved_category_id', after_json -> 'resolved_category_id');
  elsif tg_table_name = 'supplier_directory_categories' then
    record_id := (after_json ->> 'id')::uuid;
    before_json := case when before_json is null then null else jsonb_build_object('name', before_json -> 'name', 'parent_id', before_json -> 'parent_id', 'active', before_json -> 'active') end;
    after_json := jsonb_build_object('name', after_json -> 'name', 'parent_id', after_json -> 'parent_id', 'active', after_json -> 'active');
  else
    record_id := (after_json ->> 'id')::uuid;
    before_json := case when before_json is null then null else jsonb_build_object('name', before_json -> 'name', 'parent_id', before_json -> 'parent_id', 'active', before_json -> 'active', 'verified', before_json -> 'verified') end;
    after_json := jsonb_build_object('name', after_json -> 'name', 'parent_id', after_json -> 'parent_id', 'active', after_json -> 'active', 'verified', after_json -> 'verified');
  end if;
  insert into public.supplier_directory_audit(actor_id, entity_type, entity_id, operation, before_state, after_state)
  values ((select auth.uid()), tg_table_name, record_id, tg_op, before_json, after_json);
  return new;
end;
$$;
revoke all on function supplier_directory_private.record_change() from public, anon, authenticated;
create trigger directory_units_audit after insert or update on public.supplier_directory_units
  for each row execute function supplier_directory_private.record_change();
create trigger directory_profiles_audit after insert or update on public.supplier_directory_profiles
  for each row execute function supplier_directory_private.record_change();
create trigger directory_roles_audit after insert or update on public.supplier_directory_roles
  for each row execute function supplier_directory_private.record_change();
create trigger directory_categories_audit after insert or update on public.supplier_directory_categories
  for each row execute function supplier_directory_private.record_change();
create trigger directory_category_requests_audit after insert or update on public.supplier_directory_category_requests
  for each row execute function supplier_directory_private.record_change();

-- SECURITY INVOKER deliberately keeps the caller subject to column grants and
-- RLS. The update and viewer grant either both succeed or both roll back.
create function public.supplier_directory_decide_profile(target_user uuid, decision text, note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  target_unit uuid;
  acting_user uuid := (select auth.uid());
begin
  if acting_user is null or decision not in ('active', 'rejected') or decision is null then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if decision = 'rejected' and length(trim(coalesce(note, ''))) < 2 then
    raise exception 'Rejection requires a reason' using errcode = '22023';
  end if;
  if length(coalesce(note, '')) > 2000 then
    raise exception 'Decision note is too long' using errcode = '22023';
  end if;
  update public.supplier_directory_profiles
    set status = decision, reviewed_at = now(), reviewed_by = acting_user, review_note = note
    where user_id = target_user and status = 'pending'
    returning unit_id into target_unit;
  if not found then
    raise exception 'Request not found, not pending, or not authorized' using errcode = '42501';
  end if;
  if decision = 'active' then
    if not exists (
      select 1 from public.supplier_directory_units u
      join public.supplier_directory_units parent on parent.id = u.parent_id
      where u.id = target_unit and u.kind = 'department' and u.active and u.verified
        and parent.kind = 'administration' and parent.active and parent.verified
    ) then
      raise exception 'Department or administration is not active and verified' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.supplier_directory_roles r where r.user_id = target_user
        and r.unit_id = target_unit and r.role = 'viewer' and r.revoked_at is null
        and r.granted_at <= now() and (r.expires_at is null or r.expires_at > now())
    ) then
      insert into public.supplier_directory_roles(user_id, role, unit_id, granted_by)
        values (target_user, 'viewer', target_unit, acting_user);
    end if;
  end if;
  return jsonb_build_object('status', decision);
end;
$$;
revoke all on function public.supplier_directory_decide_profile(uuid, text, text) from public, anon, authenticated;
grant execute on function public.supplier_directory_decide_profile(uuid, text, text) to authenticated;

-- Approving a new category and resolving its request are a single transaction.
-- RLS and grants remain in force because this function is SECURITY INVOKER.
create function public.supplier_directory_decide_category(
  target_request uuid, decision text, note text, existing_category uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  request_row public.supplier_directory_category_requests%rowtype;
  category_id uuid;
  acting_user uuid := (select auth.uid());
begin
  if acting_user is null or decision is null or decision not in ('approved', 'linked', 'rejected')
     or length(trim(coalesce(note, ''))) < 2 or length(coalesce(note, '')) > 2000 then
    raise exception 'Invalid category decision' using errcode = '22023';
  end if;
  if (decision = 'linked' and existing_category is null)
     or (decision <> 'linked' and existing_category is not null) then
    raise exception 'Invalid existing category' using errcode = '22023';
  end if;
  select * into request_row from public.supplier_directory_category_requests
    where id = target_request and status = 'pending' for update;
  if not found then
    raise exception 'Request not found, not pending, or not authorized' using errcode = '42501';
  end if;
  if decision = 'approved' then
    insert into public.supplier_directory_categories(name, description, parent_id, created_by)
      values (request_row.proposed_name, request_row.description, request_row.parent_id, acting_user)
      returning id into category_id;
  elsif decision = 'linked' then
    select id into category_id from public.supplier_directory_categories where id = existing_category and active;
    if not found then raise exception 'Category is unavailable' using errcode = '22023'; end if;
  end if;
  update public.supplier_directory_category_requests
    set status = decision, decision_note = note, decided_by = acting_user, decided_at = now(),
        resolved_category_id = category_id
    where id = target_request and status = 'pending';
  if not found then raise exception 'Request could not be resolved' using errcode = '42501'; end if;
  return jsonb_build_object('status', decision, 'category_id', category_id);
end;
$$;
revoke all on function public.supplier_directory_decide_category(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.supplier_directory_decide_category(uuid, text, text, uuid) to authenticated;


-- Test fixtures refer to an existing auth identity but modify only new tables.
do $$
declare uid uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then raise exception 'Test requires one existing auth user'; end if;
  perform set_config('directory_test.user_id', uid::text, true);
  insert into public.supplier_directory_units(id, name, kind, active, verified)
    values ('10000000-0000-0000-0000-000000000001', 'Test administration', 'administration', true, true);
  insert into public.supplier_directory_units(id, name, kind, parent_id, active, verified)
    values ('10000000-0000-0000-0000-000000000002', 'Test department', 'department',
            '10000000-0000-0000-0000-000000000001', true, true);
  insert into public.supplier_directory_profiles(user_id, first_name, last_name, job_title, unit_id,
      purpose, status, reviewed_at, reviewed_by)
    values (uid, 'Test', 'User', 'Test', '10000000-0000-0000-0000-000000000002',
            'Testing only', 'active', now(), uid);
  insert into public.supplier_directory_roles(user_id, role, granted_by) values (uid, 'admin', uid);
  insert into public.supplier_directory_categories(name, created_by) values ('Test category', uid);
  if has_table_privilege('anon', 'public.supplier_directory_categories', 'select') then
    raise exception 'Anonymous role has category select';
  end if;
  if has_column_privilege('authenticated', 'public.supplier_directory_profiles', 'status', 'insert') then
    raise exception 'Users can insert an approved profile';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('directory_test.user_id'), 'role', 'authenticated', 'is_anonymous', false)::text, true);
do $$ begin
  if not supplier_directory_private.is_admin() or not supplier_directory_private.active_user() then
    raise exception 'Active administrator was denied';
  end if;
  if (select count(*) from public.supplier_directory_categories) <> 1 then
    raise exception 'Active administrator cannot read categories';
  end if;
  if (select count(*) from public.supplier_directory_audit) < 5 then
    raise exception 'Audit entries were not created';
  end if;
end $$;

-- An identity with no profile or role must not see categories or submit a request.
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
do $$ begin
  if supplier_directory_private.active_user() then raise exception 'Unknown user has access'; end if;
  if (select count(*) from public.supplier_directory_categories) <> 0 then
    raise exception 'Unknown user can see categories';
  end if;
  begin
    insert into public.supplier_directory_category_requests(requested_by, proposed_name, description)
      values ('20000000-0000-0000-0000-000000000001', 'Unauthorized', 'Should be denied');
    raise exception 'Unknown user submitted a category request';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('directory_test.user_id'), 'role', 'authenticated', 'is_anonymous', false)::text, true);
update public.supplier_directory_roles set revoked_at = now()
  where user_id = current_setting('directory_test.user_id')::uuid and role = 'admin';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('directory_test.user_id'), 'role', 'authenticated', 'is_anonymous', false)::text, true);
do $$ begin
  if supplier_directory_private.active_user() or supplier_directory_private.is_admin() then
    raise exception 'Revoked role still has access';
  end if;
  if (select count(*) from public.supplier_directory_categories) <> 0 then
    raise exception 'Revoked user can still see categories';
  end if;
end $$;
reset role;
rollback;
select 'rollback test passed; all fixtures reverted' as result;
