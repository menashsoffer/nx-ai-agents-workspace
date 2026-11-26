-- Supplier personal area, stage 5: "המשתמשים שלנו" (supplier-portal-spec-he.md 6.8, 7.2).
-- An owner of a supplier sees who is linked to it, invites colleagues by email and removes
-- them. The invitee accepts with portal_accept_invite once they sign in with that email.
-- A supplier always keeps at least one active owner.

-- The caller must be an active owner of the supplier.
create function private.require_portal_owner(target uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_portal_caller();
  if private.portal_role(target) is distinct from 'owner' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;

-- The people linked to the supplier (active ones) and the invites still open.
create function public.portal_members(supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_portal_owner(supplier_id);
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', a.id,
        'first_name', p.first_name, 'last_name', p.last_name, 'job_title', p.job_title,
        'email', u.email, 'role', a.role, 'method', a.method, 'created_at', a.created_at,
        'is_me', a.user_id = auth.uid()) order by a.role desc, a.created_at)
      from public.supplier_accounts a
      left join public.portal_people p on p.user_id = a.user_id
      left join auth.users u on u.id = a.user_id
      where a.supplier_id = portal_members.supplier_id and a.status = 'active'), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email,
        'role', i.role, 'expires_at', i.expires_at) order by i.created_at)
      from public.supplier_invites i
      where i.supplier_id = portal_members.supplier_id and i.accepted_at is null
        and i.expires_at > now()), '[]'::jsonb));
end;
$$;

-- An owner invites a colleague. Unlike staff invites, any address may be invited: the owner
-- speaks for the supplier. Inviting the same address again returns the open invite.
create function public.portal_invite_member(invite jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  target uuid;
  address text := lower(trim(coalesce(invite ->> 'email', '')));
  wanted text := coalesce(invite ->> 'role', 'member');
  invite_id uuid;
begin
  if coalesce(invite ->> 'supplier_id', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  target := (invite ->> 'supplier_id')::uuid;
  perform private.require_portal_owner(target);
  if wanted not in ('owner', 'member') then
    raise exception 'reason:bad_choice' using errcode = '22023';
  end if;
  if address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(address) > 254 then
    -- The site checks the address first, so this is only a backstop.
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  select i.id into invite_id from public.supplier_invites i
  where i.supplier_id = target and i.email = address and i.accepted_at is null
    and i.expires_at > now();
  if invite_id is not null then
    update public.supplier_invites set role = wanted where id = invite_id;
    return invite_id;
  end if;
  if not private.take_quota('portal_invite', 20, interval '1 day') then
    raise exception 'reason:too_many_attempts' using errcode = '54000';
  end if;
  insert into public.supplier_invites (supplier_id, email, role)
  values (target, address, wanted) returning id into invite_id;
  return invite_id;
end;
$$;

-- An owner withdraws an open invite: it simply expires now.
create function public.portal_cancel_invite(invite_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  target uuid;
begin
  select i.supplier_id into target from public.supplier_invites i
  where i.id = invite_id and i.accepted_at is null and i.expires_at > now();
  if target is null then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
  perform private.require_portal_owner(target);
  update public.supplier_invites set expires_at = now() where id = invite_id;
end;
$$;

-- An owner removes a colleague, or themselves, but never the last active owner.
create function public.portal_remove_member(account_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  account public.supplier_accounts;
begin
  select * into account from public.supplier_accounts a
  where a.id = account_id and a.status = 'active';
  if account.id is null then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
  perform private.require_portal_owner(account.supplier_id);
  -- Lock the supplier's owners, so two owners removing each other cannot both succeed.
  perform 1 from public.supplier_accounts a where a.supplier_id = account.supplier_id
    and a.role = 'owner' and a.status = 'active' for update;
  if account.role = 'owner' and not exists (select 1 from public.supplier_accounts a
    where a.supplier_id = account.supplier_id and a.role = 'owner' and a.status = 'active'
      and a.id <> account.id) then
    -- The site never offers this, so it is a backstop without a reason text of its own.
    raise exception 'Last owner' using errcode = '22023';
  end if;
  update public.supplier_accounts set status = 'revoked', decided_by = auth.uid(),
    decided_at = now(), decision_note = 'הוסר בידי מורשה של הספק'
  where id = account.id;
end;
$$;

revoke all on function private.require_portal_owner(uuid) from public, anon;
grant execute on function private.require_portal_owner(uuid) to authenticated;
revoke all on function public.portal_members(uuid), public.portal_invite_member(jsonb),
  public.portal_cancel_invite(uuid), public.portal_remove_member(uuid) from public, anon;
grant execute on function public.portal_members(uuid), public.portal_invite_member(jsonb),
  public.portal_cancel_invite(uuid), public.portal_remove_member(uuid) to authenticated;
