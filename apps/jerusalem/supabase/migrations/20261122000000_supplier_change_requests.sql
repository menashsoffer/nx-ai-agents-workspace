-- Supplier edits with automatic checks (documentation/supplier-edit-checks-spec-he.md,
-- stage 1). Every change to a supplier's name, entity kind or a contact is checked in
-- the database first. Each check is green, yellow or red: green is saved at once,
-- yellow waits for a decision, red is refused. Checks against a registry over the
-- network come in stage 2; here the registrar name already stored on an identifier is used.
-- update_supplier keeps working for the current site until it moves to these functions.

-- Decisions 4 and 6 (22.11.2026): a cooperative kind, and a person is a sole trader.
update public.suppliers set entity_kind = 'sole_trader' where entity_kind = 'individual';
alter table public.suppliers drop constraint suppliers_entity_kind_check;
alter table public.suppliers add constraint suppliers_entity_kind_check check (entity_kind in (
  'company', 'sole_trader', 'nonprofit', 'partnership', 'cooperative', 'public_body', 'unknown'
));
-- A sole trader is a person, so the address check keeps their address off the map service,
-- as it did for 'individual'. No live supplier is a sole trader on 22.11.2026.
create or replace view private.address_check_backlog as
  select c.id as contact_id, c.value, a.contact_id is not null as rechecked, c.updated_at
  from public.supplier_contacts c
  join public.suppliers s on s.id = c.supplier_id
  left join public.address_checks a on a.contact_id = c.id
  where c.kind = 'address' and c.status = 'current' and s.entity_kind <> 'sole_trader'
    and (a.contact_id is null or a.checked_value <> c.value
      or (a.result = 'failed' and a.checked_at < now() - interval '1 day'));

create table public.supplier_change_requests (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  change_kind text not null check (change_kind in ('rename', 'entity_kind', 'contact')),
  contact_kind text check (contact_kind in ('email', 'phone', 'address', 'website', 'contact_person')),
  contact_id uuid references public.supplier_contacts (id) on delete set null,
  old_value text,
  new_value text not null check (length(new_value) between 1 and 500),
  reason text check (length(reason) <= 500),
  checks jsonb not null check (jsonb_typeof(checks) = 'array'),
  outcome text not null check (outcome in ('green', 'yellow')),
  status text not null check (status in ('pending', 'applied', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((change_kind = 'contact') = (contact_kind is not null))
);
create index supplier_change_requests_supplier_idx
  on public.supplier_change_requests (supplier_id, created_at desc);
create index supplier_change_requests_pending_idx
  on public.supplier_change_requests (created_at) where status = 'pending';
create index supplier_change_requests_contact_idx on public.supplier_change_requests (contact_id);
create index supplier_change_requests_decided_by_idx on public.supplier_change_requests (decided_by);
select private.track_table('public.supplier_change_requests');

alter table public.supplier_change_requests enable row level security;
revoke all on public.supplier_change_requests from public, anon, authenticated;
grant select on public.supplier_change_requests to authenticated;
-- The requester, whoever may decide it, and the auditor. Writes go through the functions.
create policy supplier_change_requests_read on public.supplier_change_requests for select
  to authenticated using (
    created_by = (select auth.uid())
    or (select private.is_admin())
    or (select private.is_auditor())
    or (change_kind = 'contact' and (select private.has_role(array['editor', 'unit_manager'])))
  );

-- Closes the way around the checks: name and kind change only in functions. review_status
-- stays, because a unit manager verifies a supplier there and guard_verification checks it.
revoke update (display_name, entity_kind) on public.suppliers from authenticated;

-- True when b is at most max_edits insertions, deletions or substitutions away from a.
create function private.within_edits(a text, b text, max_edits int)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  previous int[];
  current_row int[];
  i int;
  j int;
begin
  if abs(length(a) - length(b)) > max_edits then return false; end if;
  previous := array(select generate_series(0, length(b)));
  for i in 1..length(a) loop
    current_row := array[i];
    for j in 1..length(b) loop
      current_row := current_row || least(previous[j + 1] + 1, current_row[j] + 1,
        previous[j] + (substr(a, i, 1) <> substr(b, j, 1))::int);
    end loop;
    previous := current_row;
  end loop;
  return previous[length(b) + 1] <= max_edits;
end;
$$;

-- The entity kinds an identifier scheme allows. A public body can hold a company or
-- nonprofit number.
create function private.kind_fits_scheme(kind text, scheme text)
returns boolean language sql immutable set search_path = '' as $$
  select case scheme
    when 'company' then kind in ('company', 'public_body')
    when 'nonprofit' then kind in ('nonprofit', 'public_body')
    else kind = 'sole_trader'
  end;
$$;

-- The kind a supplier's own name suggests, 'conflict' for two different hints, or null.
create function private.kind_hint(name text)
returns text language sql immutable set search_path = '' as $$
  select case when count(distinct hint) > 1 then 'conflict' else min(hint) end
  from (values
    (case when name ~ 'בע["״'']?מ' or name ~ 'חל["״'']?צ' then 'company' end),
    (case when name ~ 'ע["״'']ר|עמות' then 'nonprofit' end),
    (case when name ~ 'אגודה שיתופית|אגש["״'']ח' then 'cooperative' end)
  ) hints (hint)
  where hint is not null;
$$;

create function private.change_check(name text, outcome text, extra jsonb default '{}')
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('check', name, 'outcome', outcome) || extra;
$$;

-- Spec section 4.1.
create function private.rename_checks(s public.suppliers, new_name text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  problem text := private.rule_problem('supplier_name', new_name);
  wanted text := private.normalize_name(new_name);
  other public.suppliers;
  registrar text;
  verified boolean;
  result jsonb := '[]';
begin
  if problem is not null or new_name = s.display_name then
    return jsonb_build_array(private.change_check('name_rule', 'red',
      jsonb_build_object('problem', coalesce(problem, 'no_change'))));
  end if;
  select * into other from public.suppliers o
  where o.status = 'active' and o.id <> s.id
    and (o.normalized_name = wanted or extensions.similarity(o.normalized_name, wanted) >= 0.8)
  order by o.normalized_name = wanted desc, extensions.similarity(o.normalized_name, wanted) desc
  limit 1;
  if found then
    result := result || private.change_check('other_supplier',
      case when other.normalized_name = wanted then 'red' else 'yellow' end,
      jsonb_build_object('supplier_id', other.id, 'name', other.display_name));
  end if;
  select i.registrar_name, i.review_status = 'verified' into registrar, verified
  from public.supplier_identifiers i
  where i.supplier_id = s.id and i.review_status <> 'rejected' and i.registrar_name is not null
  order by i.review_status = 'verified' desc limit 1;
  if verified and private.normalize_name(registrar) = wanted then
    return result || private.change_check('registrar_name', 'green',
      jsonb_build_object('name', registrar));
  end if;
  if registrar is not null then
    result := result || private.change_check('registrar_name', 'yellow',
      jsonb_build_object('name', registrar));
  elsif s.entity_kind = 'sole_trader' then
    result := result || private.change_check('no_registry', 'yellow');
  end if;
  return result || private.change_check('change_size',
    case when private.within_edits(s.display_name, new_name, 3) then 'green' else 'yellow' end);
end;
$$;

-- Spec section 4.3.
create function private.kind_checks(s public.suppliers, new_kind text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  scheme text;
  verified boolean;
  hint text := private.kind_hint(s.display_name);
  result jsonb := '[]';
begin
  if new_kind is null or new_kind = s.entity_kind or new_kind not in ('company', 'sole_trader',
    'nonprofit', 'partnership', 'cooperative', 'public_body', 'unknown') then
    return jsonb_build_array(private.change_check('kind_rule', 'red',
      jsonb_build_object('problem', case when new_kind = s.entity_kind then 'no_change'
        else 'bad_choice' end)));
  end if;
  select i.scheme, i.review_status = 'verified' into scheme, verified
  from public.supplier_identifiers i
  where i.supplier_id = s.id and i.review_status <> 'rejected'
  order by i.review_status = 'verified' desc limit 1;
  if scheme is null then
    result := result || private.change_check('identifier_kind', 'yellow',
      jsonb_build_object('problem', 'no_identifier'));
  else
    result := result || private.change_check('identifier_kind',
      case when private.kind_fits_scheme(new_kind, scheme) then 'green'
        when verified then 'red' else 'yellow' end,
      jsonb_build_object('scheme', scheme, 'verified', verified));
  end if;
  if hint is not null then
    result := result || private.change_check('name_kind',
      case when hint = new_kind then 'green' else 'yellow' end, jsonb_build_object('hint', hint));
  end if;
  return result;
end;
$$;

-- Spec section 4.4. Address and website checks over the network come in stage 2.
create function private.contact_checks(s public.suppliers, contact_kind text, contact_id uuid,
  new_value text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  problem text := case when contact_kind in ('email', 'phone', 'address', 'website',
    'contact_person') then private.rule_problem(contact_kind, new_value) else 'bad_choice' end;
  wanted text := case contact_kind when 'email' then lower(trim(new_value))
    when 'phone' then regexp_replace(new_value, '[^0-9+]', '', 'g') else trim(new_value) end;
  other public.suppliers;
begin
  if problem is null and exists (select 1 from public.supplier_contacts c
    where c.supplier_id = s.id and c.kind = contact_kind and c.status = 'current'
      and c.normalized_value = wanted) then
    problem := 'no_change';
  elsif problem is null and contact_id is not null and not exists (
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

create function private.change_outcome(checks jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when checks @> '[{"outcome": "red"}]' then 'red'
    when checks @> '[{"outcome": "yellow"}]' then 'yellow'
    else 'green'
  end;
$$;

-- The supplier a change is for, after the caller's role and the input shape are checked.
create function private.change_supplier(change jsonb, lock boolean)
returns public.suppliers language plpgsql volatile set search_path = '' as $$
declare
  s public.suppliers;
begin
  if not private.has_role(array['editor', 'unit_manager']) then
    raise exception 'Not permitted to edit supplier' using errcode = '42501';
  end if;
  if jsonb_typeof(change) is distinct from 'object'
    or change - array['supplier_id', 'kind', 'value', 'contact_kind', 'contact_id', 'reason']
      <> '{}'::jsonb
    or coalesce(change ->> 'kind', '') not in ('rename', 'entity_kind', 'contact')
    or jsonb_typeof(change -> 'value') is distinct from 'string'
    or coalesce(change ->> 'supplier_id', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(change ->> 'contact_id', '') !~ '^([0-9a-f-]{36})?$' then
    raise exception 'Invalid supplier change' using errcode = '22023';
  end if;
  if lock then
    select * into s from public.suppliers where id = (change ->> 'supplier_id')::uuid for update;
  else
    select * into s from public.suppliers where id = (change ->> 'supplier_id')::uuid;
  end if;
  if not found or s.status = 'merged' then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  elsif s.status = 'inactive' then
    raise exception 'reason:supplier_inactive' using errcode = '22023';
  end if;
  return s;
end;
$$;

create function private.supplier_change_checks(s public.suppliers, change jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select case change ->> 'kind'
    when 'rename' then private.rename_checks(s, trim(change ->> 'value'))
    when 'entity_kind' then private.kind_checks(s, change ->> 'value')
    else private.contact_checks(s, change ->> 'contact_kind',
      nullif(change ->> 'contact_id', '')::uuid, change ->> 'value')
  end;
$$;

-- The value the change replaces, as it is now.
create function private.change_old_value(s public.suppliers, kind text, contact uuid)
returns text language sql stable set search_path = '' as $$
  select case kind
    when 'rename' then s.display_name
    when 'entity_kind' then s.entity_kind
    else (select c.value from public.supplier_contacts c
      where c.id = contact and c.supplier_id = s.id and c.status = 'current')
  end;
$$;

create function private.apply_supplier_change(r public.supplier_change_requests)
returns void language plpgsql volatile set search_path = '' as $$
begin
  if r.change_kind = 'rename' then
    perform public.rename_supplier(jsonb_build_object(
      'supplier_id', r.supplier_id, 'display_name', r.new_value));
  elsif r.change_kind = 'entity_kind' then
    update public.suppliers set entity_kind = r.new_value where id = r.supplier_id;
  else
    perform public.replace_supplier_contact(jsonb_build_object('supplier_id', r.supplier_id,
      'contact_id', coalesce(r.contact_id::text, ''), 'kind', r.contact_kind,
      'value', r.new_value));
  end if;
end;
$$;

-- What the edit dialog shows before saving. Nothing is written.
create function public.check_supplier_change(change jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  checks jsonb := private.supplier_change_checks(private.change_supplier(change, false), change);
begin
  return jsonb_build_object('outcome', private.change_outcome(checks), 'checks', checks);
end;
$$;

-- Spec section 5: green is saved at once, yellow waits, red is refused. An admin's change
-- is saved at once. A rename always needs a reason, and so does a yellow kind change.
create function public.submit_supplier_change(change jsonb)
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
    trim(change ->> 'value'), reason, checks, outcome,
    case when admin then 'approved' when outcome = 'green' then 'applied' else 'pending' end,
    case when admin then auth.uid() end, case when admin then now() end)
  returning * into r;
  if r.status <> 'pending' then perform private.apply_supplier_change(r); end if;
  return jsonb_build_object('request_id', r.id, 'status', r.status, 'outcome', outcome,
    'checks', checks);
end;
$$;

-- A contact change is decided by another editor, unit manager or admin; a name or kind
-- change by an admin. The checks run again, because the supplier may have changed since.
create function public.decide_supplier_change(request_id uuid, approve boolean, note text)
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
      'kind', r.change_kind, 'value', r.new_value, 'contact_kind', r.contact_kind,
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

create function public.cancel_supplier_change(request_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.supplier_change_requests set status = 'cancelled'
  where id = request_id and status = 'pending' and created_by = auth.uid();
  if not found then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
end;
$$;

-- rename_supplier used the direct column grant revoked above. It now checks the role
-- itself and runs as the owner. Otherwise unchanged.
create or replace function public.rename_supplier(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  new_name text := nullif(trim(payload ->> 'display_name'), '');
  previous_name text;
begin
  if not private.has_role(array['editor', 'unit_manager']) then
    raise exception 'Not permitted to edit supplier' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) <> 'object' or payload - array['supplier_id', 'display_name'] <> '{}'::jsonb
    or supplier is null or new_name is null then
    raise exception 'Invalid supplier name' using errcode = '22023';
  end if;
  select s.display_name into previous_name from public.suppliers s
    where s.id = supplier and s.status = 'active' for update;
  if previous_name is null then raise exception 'reason:supplier_unavailable' using errcode = '22023'; end if;
  if previous_name = new_name then return supplier; end if;
  update public.suppliers set display_name = new_name, review_status = 'needs_review' where id = supplier;
  insert into public.supplier_names (supplier_id, name, kind)
  values (supplier, previous_name, 'former_name') on conflict do nothing;
  return supplier;
end;
$$;

revoke all on function private.within_edits(text, text, int), private.kind_fits_scheme(text, text),
  private.kind_hint(text), private.change_check(text, text, jsonb),
  private.rename_checks(public.suppliers, text), private.kind_checks(public.suppliers, text),
  private.contact_checks(public.suppliers, text, uuid, text), private.change_outcome(jsonb),
  private.change_supplier(jsonb, boolean), private.supplier_change_checks(public.suppliers, jsonb),
  private.change_old_value(public.suppliers, text, uuid),
  private.apply_supplier_change(public.supplier_change_requests)
  from public, anon, authenticated;
revoke all on function public.check_supplier_change(jsonb), public.submit_supplier_change(jsonb),
  public.decide_supplier_change(uuid, boolean, text), public.cancel_supplier_change(uuid)
  from public, anon;
grant execute on function public.check_supplier_change(jsonb), public.submit_supplier_change(jsonb),
  public.decide_supplier_change(uuid, boolean, text), public.cancel_supplier_change(uuid)
  to authenticated;
