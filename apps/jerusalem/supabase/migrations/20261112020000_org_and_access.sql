-- Organisation and access: municipal units, staff profiles and role grants.
-- Replaces the single JWT role with roles held in the database, per unit.

create table public.org_units (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  kind text not null check (kind in ('administration', 'department')),
  parent_id uuid references public.org_units (id) on delete restrict,
  source_url text check (source_url ~ '^https://'),
  verified boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (
    (kind = 'administration' and parent_id is null)
    or (kind = 'department' and parent_id is not null and parent_id <> id)
  )
);
create index org_units_parent_idx on public.org_units (parent_id);
create unique index org_units_name_idx
  on public.org_units (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name)));

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  email text not null check (length(email) <= 320),
  job_title text not null check (length(trim(job_title)) between 1 and 200),
  phone text check (length(phone) <= 80),
  unit_id uuid references public.org_units (id) on delete restrict,
  purpose text not null check (length(trim(purpose)) between 5 and 1000),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'rejected', 'blocked')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  review_note text check (length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (status <> 'pending' or (unit_id is not null and reviewed_at is null)),
  check (status = 'pending' or reviewed_at is not null),
  check (status <> 'rejected' or length(trim(coalesce(review_note, ''))) >= 2)
);
create index profiles_unit_idx on public.profiles (unit_id);
create index profiles_reviewed_by_idx on public.profiles (reviewed_by);

create table public.role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor', 'unit_manager', 'admin')),
  unit_id uuid references public.org_units (id) on delete restrict,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((role = 'admin') = (unit_id is null)),
  check (expires_at is null or expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);
create index role_grants_user_idx on public.role_grants (user_id);
create index role_grants_unit_idx on public.role_grants (unit_id);
create unique index role_grants_active_idx
  on public.role_grants (user_id, role, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

select private.track_table('public.org_units');
select private.track_table('public.profiles', '{phone,purpose,review_note}');
select private.track_table('public.role_grants');

-- Access helpers. SECURITY DEFINER so policies can read grants without recursion;
-- each one answers only about the calling user.
create function private.has_role(wanted text[], target_unit uuid default null)
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
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and (g.role = 'admin' or (g.role = any (wanted)
        and (target_unit is null or g.unit_id = target_unit)))
  )
$$;

create function private.is_admin()
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
      and g.role = 'admin'
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
  )
$$;

create function private.is_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_role(array['viewer', 'editor', 'unit_manager'])
$$;

-- False for a null unit, so a manager never sees rows that belong to no unit.
create function private.manages_unit(target_unit uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select target_unit is not null and private.has_role(array['unit_manager'], target_unit)
$$;

revoke all on function private.has_role(text[], uuid), private.is_admin(), private.is_member(),
  private.manages_unit(uuid) from public, anon;
grant execute on function private.has_role(text[], uuid), private.is_admin(), private.is_member(),
  private.manages_unit(uuid) to authenticated;

alter table public.org_units enable row level security;
alter table public.profiles enable row level security;
alter table public.role_grants enable row level security;
revoke all on public.org_units, public.profiles, public.role_grants from public, anon, authenticated;

grant select on public.org_units to authenticated;
grant insert (name, kind, parent_id, source_url, verified, active),
  update (name, kind, parent_id, source_url, verified, active)
  on public.org_units to authenticated;
create policy org_units_read on public.org_units for select to authenticated
  using ((active and verified) or (select private.is_admin()));
create policy org_units_admin_insert on public.org_units for insert to authenticated
  with check ((select private.is_admin()));
create policy org_units_admin_update on public.org_units for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

grant select on public.profiles to authenticated;
grant insert (user_id, first_name, last_name, email, job_title, phone, unit_id, purpose)
  on public.profiles to authenticated;
grant update (first_name, last_name, job_title, phone) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
    or private.manages_unit(unit_id)
  );
create policy profiles_signup on public.profiles for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true'
    and email = ((select auth.jwt()) ->> 'email')
    and exists (
      select 1 from public.org_units u
      where u.id = unit_id and u.kind = 'department' and u.active and u.verified
    )
  );
create policy profiles_edit_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()))
  with check (user_id = (select auth.uid()) or (select private.is_admin()));

grant select on public.role_grants to authenticated;
create policy role_grants_read on public.role_grants for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
    or private.manages_unit(unit_id)
  );
