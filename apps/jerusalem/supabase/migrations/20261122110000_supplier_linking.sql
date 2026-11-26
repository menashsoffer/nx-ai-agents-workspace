-- Supplier personal area, stage 1 (supplier-portal spec, sections 5, 6.2, 6.3, 7).
-- A person links to a supplier in one of three ways: a staff invite to an email the supplier
-- already has, an exact match of the sign-in email with such an email, or a proof file an
-- admin reviews. Never by a similar name. Suppliers then read their own file through
-- portal_supplier, which returns only the fields listed in section 7.3.

-- Private bucket for link proofs now and supplier documents in stage 4.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-documents', 'supplier-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- A person uploads proofs only under link-proofs/<their id>/ and reads only their own.
-- Admins read every proof. Nobody replaces or deletes one.
create policy supplier_link_proof_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'supplier-documents'
    and (storage.foldername(name))[1] = 'link-proofs'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');
create policy supplier_link_proof_read on storage.objects for select to authenticated
  using (bucket_id = 'supplier-documents' and (storage.foldername(name))[1] = 'link-proofs'
    and ((storage.foldername(name))[2] = (select auth.uid())::text
      or (select private.is_admin())));

create table public.supplier_invites (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+$'),
  role text not null default 'owner' check (role in ('owner', 'member')),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  account_id uuid references public.supplier_accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index supplier_invites_supplier_idx on public.supplier_invites (supplier_id);
create index supplier_invites_email_idx on public.supplier_invites (email);
create index supplier_invites_account_idx on public.supplier_invites (account_id);
select private.track_table('public.supplier_invites');

alter table public.supplier_invites enable row level security;
revoke all on public.supplier_invites from public, anon, authenticated;
grant select on public.supplier_invites to authenticated;
create policy supplier_invites_read on public.supplier_invites for select to authenticated
  using ((select private.is_member()) or (select private.can_read_all()));

create function private.jwt_email()
returns text language sql stable set search_path = '' as $$
  select case when coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
    then nullif(lower(trim(auth.jwt() ->> 'email')), '') end
$$;

-- True when the email is one of the supplier's current, well-formed email contacts.
create function private.supplier_has_email(target uuid, email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.supplier_contacts c
    where c.supplier_id = target and c.kind = 'email' and c.status = 'current' and c.is_valid
      and c.normalized_value = email)
$$;

create function private.require_portal_caller()
returns void language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null or private.jwt_email() is null then
    raise exception 'reason:sign_in_required' using errcode = '42501';
  end if;
end;
$$;

create function private.portal_accounts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'supplier_id', a.supplier_id,
    'supplier_name', s.display_name, 'role', a.role, 'status', a.status, 'method', a.method,
    'decision_note', a.decision_note, 'created_at', a.created_at,
    'decided_at', a.decided_at) order by a.created_at desc), '[]'::jsonb)
  from public.supplier_accounts a join public.suppliers s on s.id = a.supplier_id
  where a.user_id = auth.uid()
$$;

create function private.portal_invites()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'supplier_name', s.display_name,
    'role', i.role, 'expires_at', i.expires_at) order by i.created_at), '[]'::jsonb)
  from public.supplier_invites i join public.suppliers s on s.id = i.supplier_id
  where i.email = private.jwt_email() and i.accepted_at is null and i.expires_at > now()
    and s.status = 'active'
$$;

-- Who the caller is on the supplier side: details, links and open invites to their email.
create function public.portal_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_portal_caller();
  return jsonb_build_object(
    'email', private.jwt_email(),
    'person', (select to_jsonb(p) - 'created_by' - 'created_at' - 'updated_at'
      from public.portal_people p where p.user_id = auth.uid()),
    'accounts', private.portal_accounts(),
    'invites', private.portal_invites());
end;
$$;

-- Finds a supplier by a full, valid company or nonprofit number. Only the name comes back,
-- and the quota stops anyone from walking the list.
create function public.portal_find_supplier(scheme text, value text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_portal_caller();
  if scheme not in ('company', 'nonprofit') or value !~ '^[0-9]{9}$'
    or not private.valid_check_digit(value) then
    raise exception 'reason:identifier_invalid' using errcode = '22023';
  end if;
  if not private.take_quota('portal_link', 10, interval '1 hour') then
    raise exception 'reason:too_many_attempts' using errcode = '54000';
  end if;
  return (select jsonb_build_object('supplier_id', s.id, 'name', s.display_name)
    from public.supplier_identifiers i join public.suppliers s on s.id = i.supplier_id
    where i.scheme = portal_find_supplier.scheme and i.value = portal_find_supplier.value
      and i.review_status <> 'rejected' and s.status = 'active'
    order by s.created_at limit 1);
end;
$$;

create function private.portal_link_target(target uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.portal_people p where p.user_id = auth.uid()) then
    raise exception 'reason:person_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = target and s.status = 'active')
  then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.supplier_accounts a where a.user_id = auth.uid()
    and a.supplier_id = target and a.status in ('pending', 'active')) then
    raise exception 'reason:already_linked' using errcode = '23505';
  end if;
end;
$$;

-- Links the caller at once when their sign-in email is one the supplier already has.
-- Otherwise the request waits for an admin with a proof file the caller uploaded.
create function public.portal_request_link(request jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  target uuid;
  proof text := nullif(trim(request ->> 'proof_path'), '');
  matched boolean;
  account public.supplier_accounts;
begin
  perform private.require_portal_caller();
  if coalesce(request ->> 'supplier_id', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  target := (request ->> 'supplier_id')::uuid;
  if not private.take_quota('portal_link', 10, interval '1 hour') then
    raise exception 'reason:too_many_attempts' using errcode = '54000';
  end if;
  perform private.portal_link_target(target);
  matched := private.supplier_has_email(target, private.jwt_email());
  if not matched and (proof is null or not exists (select 1 from storage.objects o
    where o.bucket_id = 'supplier-documents' and o.name = proof
      and o.name like 'link-proofs/' || auth.uid()::text || '/%')) then
    raise exception 'reason:proof_required' using errcode = '22023';
  end if;
  insert into public.supplier_accounts (user_id, supplier_id, role, status, method,
    proof_path, decided_at)
  values (auth.uid(), target, 'owner', case when matched then 'active' else 'pending' end,
    case when matched then 'email_match' else 'document' end,
    case when matched then null else proof end, case when matched then now() end)
  returning * into account;
  return jsonb_build_object('account_id', account.id, 'status', account.status);
end;
$$;

-- Accepts an open invite sent to the caller's own sign-in email.
create function public.portal_accept_invite(invite_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  invite public.supplier_invites;
  linked uuid;
begin
  perform private.require_portal_caller();
  select * into invite from public.supplier_invites i
  where i.id = invite_id and i.email = private.jwt_email() and i.accepted_at is null
    and i.expires_at > now() for update;
  if invite.id is null then
    raise exception 'reason:invite_unavailable' using errcode = 'P0002';
  end if;
  select a.id into linked from public.supplier_accounts a where a.user_id = auth.uid()
    and a.supplier_id = invite.supplier_id and a.status in ('pending', 'active');
  if linked is null then
    perform private.portal_link_target(invite.supplier_id);
    insert into public.supplier_accounts (user_id, supplier_id, role, status, method,
      decided_at, decided_by)
    values (auth.uid(), invite.supplier_id, invite.role, 'active', 'invite', now(),
      invite.created_by)
    returning id into linked;
  else
    update public.supplier_accounts set status = 'active', decided_at = now(),
      decided_by = invite.created_by where id = linked and status = 'pending';
  end if;
  update public.supplier_invites set accepted_at = now(), account_id = linked
    where id = invite.id;
  return jsonb_build_object('account_id', linked, 'status', 'active');
end;
$$;

-- Staff invite a person through an email the supplier already has, never a new one.
create function public.invite_supplier_account(supplier_id uuid, email text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  address text := lower(trim(coalesce(email, '')));
  invite_id uuid;
begin
  if not private.has_role(array['editor', 'unit_manager']) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = supplier_id
    and s.status = 'active') then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  if not private.supplier_has_email(supplier_id, address) then
    raise exception 'reason:invite_email_unknown' using errcode = '22023';
  end if;
  select i.id into invite_id from public.supplier_invites i
  where i.supplier_id = invite_supplier_account.supplier_id and i.email = address
    and i.accepted_at is null and i.expires_at > now();
  if invite_id is null then
    insert into public.supplier_invites (supplier_id, email) values (supplier_id, address)
    returning id into invite_id;
  end if;
  return invite_id;
end;
$$;
