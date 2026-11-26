-- Supplier personal area, stage 1: the admin's decisions on links, the admin's queue, and the
-- supplier's own file (supplier-portal spec, sections 6.3, 6.10 and 7.3).

-- An admin approves or rejects a waiting link; a rejection needs a reason.
create function public.decide_supplier_account(account_id uuid, approve boolean, note text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if approve is null then
    raise exception 'reason:bad_choice' using errcode = '22023';
  end if;
  if not approve and length(trim(coalesce(note, ''))) < 2 then
    raise exception 'reason:reason_required' using errcode = '22023';
  end if;
  update public.supplier_accounts set
    status = case when approve then 'active' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(note), '')
  where id = account_id and status = 'pending';
  if not found then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
end;
$$;

-- An admin ends a link at once, with a reason the person sees.
create function public.revoke_supplier_account(account_id uuid, note text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(trim(coalesce(note, ''))) < 2 then
    raise exception 'reason:reason_required' using errcode = '22023';
  end if;
  update public.supplier_accounts set status = 'revoked', decided_by = auth.uid(),
    decided_at = now(), decision_note = trim(note)
  where id = account_id and status in ('pending', 'active');
  if not found then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
end;
$$;

-- The admin's queue: links that wait, and links made by email match in the last 7 days,
-- so a shared mailbox can be caught and revoked.
create function public.supplier_link_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'supplier_id', s.id,
      'supplier_name', s.display_name, 'status', a.status, 'method', a.method,
      'proof_path', a.proof_path, 'created_at', a.created_at,
      'email', u.email, 'first_name', p.first_name, 'last_name', p.last_name,
      'job_title', p.job_title, 'phone', p.phone) order by a.created_at)
    from public.supplier_accounts a
    join public.suppliers s on s.id = a.supplier_id
    left join auth.users u on u.id = a.user_id
    left join public.portal_people p on p.user_id = a.user_id
    where a.status = 'pending'
      or (a.status = 'active' and a.method = 'email_match'
        and a.created_at > now() - interval '7 days')), '[]'::jsonb);
end;
$$;

create function private.portal_role(target uuid)
returns text language sql stable security definer set search_path = '' as $$
  select a.role from public.supplier_accounts a
  where a.user_id = auth.uid() and a.supplier_id = target and a.status = 'active'
    and target in (select private.my_supplier_ids())
$$;

-- A personal ID is shown in full only to an owner; a member sees the last 4 digits.
create function private.portal_identifiers(target uuid, owner boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('scheme', i.scheme,
    'value', case when i.scheme = 'personal_id' and not owner
      then '*****' || right(i.value, 4) else i.value end,
    'verified', i.review_status = 'verified') order by i.scheme, i.value), '[]'::jsonb)
  from public.supplier_identifiers i
  where i.supplier_id = target and i.review_status <> 'rejected'
$$;

create function private.portal_memberships(target uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('registry', r.name, 'unit', u.name,
    'field', f.source_text, 'registered_from', m.registered_from,
    'registered_until', coalesce(m.registered_until, v.valid_until),
    'document_url', d.url) order by r.name, f.source_text), '[]'::jsonb)
  from public.memberships m
  join public.registry_versions v on v.id = m.registry_version_id
  join public.registries r on r.id = v.registry_id
  left join public.org_units u on u.id = r.owner_unit_id
  left join public.registry_fields f on f.id = m.registry_field_id
  left join public.source_documents d on d.id = v.source_document_id
  where m.supplier_id = target and m.review_status not in ('rejected', 'removed')
$$;

-- The supplier's own file, only the fields of section 7.3: no internal notes, review
-- states, history, staff names or anything about other suppliers.
create function public.portal_supplier(supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  my_role text := private.portal_role(supplier_id);
  s public.suppliers;
begin
  if my_role is null then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  select * into s from public.suppliers where id = supplier_id;
  return jsonb_build_object('id', s.id, 'name', s.display_name, 'entity_kind', s.entity_kind,
    'website', s.website, 'role', my_role,
    'other_names', coalesce((select jsonb_agg(n.name order by n.name)
      from public.supplier_names n where n.supplier_id = s.id
        and n.normalized_name <> s.normalized_name), '[]'::jsonb),
    'identifiers', private.portal_identifiers(s.id, my_role = 'owner'),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind,
      'value', c.value) order by c.kind, c.value) from public.supplier_contacts c
      where c.supplier_id = s.id and c.status = 'current'), '[]'::jsonb),
    'memberships', private.portal_memberships(s.id));
end;
$$;

revoke all on function private.jwt_email(), private.supplier_has_email(uuid, text),
  private.require_portal_caller(), private.portal_accounts(), private.portal_invites(),
  private.portal_link_target(uuid), private.portal_role(uuid),
  private.portal_identifiers(uuid, boolean), private.portal_memberships(uuid)
  from public, anon, authenticated;
grant execute on function private.jwt_email(), private.require_portal_caller()
  to authenticated;
revoke all on function public.portal_me(), public.portal_find_supplier(text, text),
  public.portal_request_link(jsonb), public.portal_accept_invite(uuid),
  public.invite_supplier_account(uuid, text), public.decide_supplier_account(uuid, boolean, text),
  public.revoke_supplier_account(uuid, text), public.supplier_link_queue(),
  public.portal_supplier(uuid)
  from public, anon;
grant execute on function public.portal_me(), public.portal_find_supplier(text, text),
  public.portal_request_link(jsonb), public.portal_accept_invite(uuid),
  public.invite_supplier_account(uuid, text), public.decide_supplier_account(uuid, boolean, text),
  public.revoke_supplier_account(uuid, text), public.supplier_link_queue(),
  public.portal_supplier(uuid)
  to authenticated;
