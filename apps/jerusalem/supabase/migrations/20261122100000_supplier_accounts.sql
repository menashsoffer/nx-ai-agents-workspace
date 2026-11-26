-- Supplier personal area, stage 0 (documentation/supplier-portal-spec-he.md, sections 4, 7.1).
-- A supplier account links a signed-in person to a supplier. It grants no staff role:
-- every staff policy and function keeps refusing these users. Rows are written only by the
-- linking functions of stage 1, so this migration grants reads and nothing else.

create table public.supplier_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  role text not null check (role in ('owner', 'member')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'rejected', 'revoked')),
  method text not null check (method in ('invite', 'email_match', 'document')),
  proof_path text check (length(proof_path) <= 500),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (method <> 'document' or proof_path is not null),
  check ((status = 'pending') = (decided_at is null)),
  check (status not in ('rejected', 'revoked')
    or length(trim(coalesce(decision_note, ''))) >= 2)
);
create index supplier_accounts_user_idx on public.supplier_accounts (user_id);
create index supplier_accounts_supplier_idx on public.supplier_accounts (supplier_id);
create index supplier_accounts_decided_by_idx on public.supplier_accounts (decided_by);
-- One live link per person and supplier; a rejected or revoked one may be requested again.
create unique index supplier_accounts_live_idx on public.supplier_accounts (user_id, supplier_id)
  where status in ('pending', 'active');

create table public.portal_people (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  job_title text check (length(trim(job_title)) between 1 and 200),
  phone text check (length(phone) <= 80),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

select private.track_table('public.supplier_accounts');
select private.track_table('public.portal_people', '{phone}');

-- The suppliers the caller may act for. The base of every supplier-side check.
create function private.my_supplier_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.supplier_id
  from public.supplier_accounts a
  join public.suppliers s on s.id = a.supplier_id
  where a.user_id = auth.uid()
    and a.status = 'active'
    and s.status = 'active'
    and coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
$$;
revoke all on function private.my_supplier_ids() from public, anon;
grant execute on function private.my_supplier_ids() to authenticated;

-- Staff who read shared data (every unit role and the auditor) see the accounts of a
-- supplier on its page; a person sees their own links.
alter table public.supplier_accounts enable row level security;
alter table public.portal_people enable row level security;
revoke all on public.supplier_accounts, public.portal_people from public, anon, authenticated;

grant select on public.supplier_accounts to authenticated;
create policy supplier_accounts_read on public.supplier_accounts for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_member())
    or (select private.can_read_all()));

grant select on public.portal_people to authenticated;
grant insert (user_id, first_name, last_name, job_title, phone),
  update (first_name, last_name, job_title, phone) on public.portal_people to authenticated;
create policy portal_people_read on public.portal_people for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_member())
    or (select private.can_read_all()));
create policy portal_people_insert_own on public.portal_people for insert to authenticated
  with check (user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');
create policy portal_people_update_own on public.portal_people for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
