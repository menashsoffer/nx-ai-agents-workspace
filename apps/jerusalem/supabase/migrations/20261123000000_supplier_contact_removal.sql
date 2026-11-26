-- Deleting a supplier's contact (Menash, monday 22.11.2026: a trash can beside each detail in
-- the edit dialog). A removal is a contact change with an empty value and the contact's id.
-- It goes through the same checks, approvals and history as any other change
-- (documentation/supplier-edit-checks-spec-he.md). Nothing is deleted: the contact is marked
-- outdated, as a replaced one is, and the request keeps the old value.

alter table public.supplier_change_requests
  drop constraint supplier_change_requests_new_value_check;
alter table public.supplier_change_requests alter column new_value drop not null;
-- A null new value is a removal, and only a contact can be removed.
alter table public.supplier_change_requests add constraint supplier_change_requests_new_value_check
  check (case when new_value is null then change_kind = 'contact'
    else length(new_value) between 1 and 500 end);

-- Green when the supplier keeps another detail of the same kind or the kind is not a phone or
-- an email. Removing the last phone or email waits for another editor.
create function private.contact_removal_checks(s public.suppliers, contact_kind text,
  contact_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  removed public.supplier_contacts;
  others int;
begin
  select * into removed from public.supplier_contacts c
  where c.id = contact_id and c.supplier_id = s.id and c.kind = contact_kind
    and c.status = 'current';
  if not found then
    return jsonb_build_array(private.change_check('contact_removal', 'red',
      jsonb_build_object('problem', 'contact_missing')));
  end if;
  select count(*) into others from public.supplier_contacts c
  where c.supplier_id = s.id and c.kind = contact_kind and c.status = 'current'
    and c.id <> removed.id;
  return jsonb_build_array(private.change_check('contact_removal',
    case when others = 0 and contact_kind in ('phone', 'email') then 'yellow' else 'green' end,
    jsonb_build_object('name', removed.value)));
end;
$$;

-- As in 20261122000000, except that a value already on another row of the supplier is
-- 'duplicate_contact', not 'no_change': the way out is to delete that row (10 suppliers had two
-- current addresses on 22.11.2026).
create or replace function private.contact_checks(s public.suppliers, contact_kind text,
  contact_id uuid, new_value text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  problem text := case when contact_kind in ('email', 'phone', 'address', 'website',
    'contact_person') then private.rule_problem(contact_kind, new_value) else 'bad_choice' end;
  wanted text := case contact_kind when 'email' then lower(trim(new_value))
    when 'phone' then regexp_replace(new_value, '[^0-9+]', '', 'g') else trim(new_value) end;
  same uuid;
  other public.suppliers;
begin
  if problem is null then
    select c.id into same from public.supplier_contacts c
    where c.supplier_id = s.id and c.kind = contact_kind and c.status = 'current'
      and c.normalized_value = wanted
    order by c.id is not distinct from contact_id desc limit 1;
    if found then
      problem := case when contact_id is null or same = contact_id then 'no_change'
        else 'duplicate_contact' end;
    end if;
  end if;
  if problem is null and contact_id is not null and not exists (
    select 1 from public.supplier_contacts c where c.id = contact_id and c.supplier_id = s.id
      and c.kind = contact_kind and c.status = 'current') then
    problem := 'contact_missing';
  end if;
  if problem is not null then
    return jsonb_build_array(private.change_check('contact_rule', 'red',
      jsonb_build_object('problem', problem)));
  end if;
  select o.* into other from public.supplier_contacts c
  join public.suppliers o on o.id = c.supplier_id
  where contact_kind in ('email', 'phone') and c.kind = contact_kind and c.status = 'current'
    and c.normalized_value = wanted and o.id <> s.id and o.status = 'active'
  limit 1;
  if found then
    return jsonb_build_array(private.change_check('shared_contact', 'yellow',
      jsonb_build_object('supplier_id', other.id, 'name', other.display_name)));
  end if;
  return jsonb_build_array(private.change_check('contact_rule', 'green'));
end;
$$;

-- An empty value on a contact change is a removal.
create or replace function private.supplier_change_checks(s public.suppliers, change jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select case
    when change ->> 'kind' = 'rename' then private.rename_checks(s, trim(change ->> 'value'))
      || private.registry_status_check(s)
    when change ->> 'kind' = 'entity_kind' then private.kind_checks(s, change ->> 'value')
      || private.registry_status_check(s)
    when trim(change ->> 'value') = '' then private.contact_removal_checks(s,
      change ->> 'contact_kind', nullif(change ->> 'contact_id', '')::uuid)
    else private.contact_checks(s, change ->> 'contact_kind',
      nullif(change ->> 'contact_id', '')::uuid, change ->> 'value')
  end;
$$;

create or replace function private.apply_supplier_change(r public.supplier_change_requests)
returns void language plpgsql volatile set search_path = '' as $$
begin
  if r.change_kind = 'rename' then
    perform public.rename_supplier(jsonb_build_object(
      'supplier_id', r.supplier_id, 'display_name', r.new_value));
  elsif r.change_kind = 'entity_kind' then
    update public.suppliers set entity_kind = r.new_value where id = r.supplier_id;
  elsif r.new_value is null then
    update public.supplier_contacts set status = 'outdated', is_primary = false
    where id = r.contact_id and supplier_id = r.supplier_id and status = 'current';
    if not found then
      raise exception 'reason:change_outdated' using errcode = 'P0002';
    end if;
  else
    perform public.replace_supplier_contact(jsonb_build_object('supplier_id', r.supplier_id,
      'contact_id', coalesce(r.contact_id::text, ''), 'kind', r.contact_kind,
      'value', r.new_value));
  end if;
end;
$$;

-- As in 20261122000000, except that an empty value is stored as null (a removal).
create or replace function public.submit_supplier_change(change jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.suppliers := private.change_supplier(change, true);
  checks jsonb := private.supplier_change_checks(s, change);
  outcome text := private.change_outcome(checks);
  reason text := nullif(trim(change ->> 'reason'), '');
  admin boolean := private.is_admin();
  r public.supplier_change_requests;
begin
  if outcome = 'red' then
    raise exception 'reason:change_blocked' using errcode = '22023';
  end if;
  if (reason is not null or change ->> 'kind' = 'rename'
    or (outcome = 'yellow' and (admin or change ->> 'kind' <> 'contact')))
    and private.text_problem(reason, 3, 500, 2) is not null then
    raise exception 'reason:change_reason_required' using errcode = '22023';
  end if;
  insert into public.supplier_change_requests (supplier_id, change_kind, contact_kind,
    contact_id, old_value, new_value, reason, checks, outcome, status, decided_by, decided_at)
  values (s.id, change ->> 'kind', nullif(change ->> 'contact_kind', ''),
    nullif(change ->> 'contact_id', '')::uuid,
    private.change_old_value(s, change ->> 'kind', nullif(change ->> 'contact_id', '')::uuid),
    nullif(trim(change ->> 'value'), ''), reason, checks, outcome,
    case when admin then 'approved' when outcome = 'green' then 'applied' else 'pending' end,
    case when admin then auth.uid() end, case when admin then now() end)
  returning * into r;
  if r.status <> 'pending' then perform private.apply_supplier_change(r); end if;
  return jsonb_build_object('request_id', r.id, 'status', r.status, 'outcome', outcome,
    'checks', checks);
end;
$$;

-- As in 20261122000000, except that a removal is checked again with its empty value.
create or replace function public.decide_supplier_change(request_id uuid, approve boolean,
  note text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.supplier_change_requests;
  s public.suppliers;
  change jsonb;
begin
  select * into r from public.supplier_change_requests where id = request_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
  if not (private.is_admin() or (r.change_kind = 'contact'
    and private.has_role(array['editor', 'unit_manager']))) then
    raise exception 'Not authorized' using errcode = '42501';
  elsif r.created_by = auth.uid() then
    raise exception 'reason:self_approval' using errcode = '42501';
  end if;
  if not approve then
    if private.text_problem(note, 2, 500, 2) is not null then
      raise exception 'reason:reason_required' using errcode = '22023';
    end if;
  else
    change := jsonb_strip_nulls(jsonb_build_object('supplier_id', r.supplier_id,
      'kind', r.change_kind, 'value', coalesce(r.new_value, ''), 'contact_kind', r.contact_kind,
      'contact_id', r.contact_id));
    s := private.change_supplier(change, true);
    if private.change_old_value(s, r.change_kind, r.contact_id) is distinct from r.old_value then
      raise exception 'reason:change_outdated' using errcode = 'P0002';
    elsif private.change_outcome(private.supplier_change_checks(s, change)) = 'red' then
      raise exception 'reason:change_blocked' using errcode = '22023';
    end if;
    perform private.apply_supplier_change(r);
  end if;
  update public.supplier_change_requests
  set status = case when approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(note), '')
  where id = request_id;
end;
$$;

-- A supplier proposes fixes from its personal area; removing a detail is not one of them yet.
create or replace function private.portal_change_target(change jsonb)
returns public.suppliers language plpgsql stable security definer set search_path = '' as $$
declare
  s public.suppliers;
begin
  if jsonb_typeof(change) is distinct from 'object'
    or change - array['supplier_id', 'kind', 'value', 'contact_kind', 'contact_id', 'reason']
      <> '{}'::jsonb
    or coalesce(change ->> 'kind', '') not in ('rename', 'entity_kind', 'contact')
    or jsonb_typeof(change -> 'value') is distinct from 'string'
    or trim(change ->> 'value') = ''
    or coalesce(change ->> 'supplier_id', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(change ->> 'contact_id', '') !~ '^([0-9a-f-]{36})?$' then
    raise exception 'Invalid supplier change' using errcode = '22023';
  end if;
  if private.portal_role((change ->> 'supplier_id')::uuid) is null then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  select * into s from public.suppliers where id = (change ->> 'supplier_id')::uuid;
  return s;
end;
$$;

revoke all on function private.contact_removal_checks(public.suppliers, text, uuid)
  from public, anon, authenticated;
