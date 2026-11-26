-- Access requests, my own details and role or unit changes (screens-spec-he.md 4 and 4.1).
-- New content rules for the access form, a table of change requests that a manager approves,
-- and one function per step so every change happens in a single transaction.

-- 1. Content rules: the same keys as web/src/lib/rules/access.ts.
create or replace function private.rule_problem(rule text, value text, today date default null)
returns text language plpgsql stable set search_path = '' as $$
begin
  return case rule
    when 'supplier_name' then private.text_problem(value, 2, 300, 1)
    when 'phone' then private.phone_problem(value)
    when 'email' then case
      when value is null or value = '' then 'required'
      when length(value) > 254 then 'too_long'
      when value !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$' then 'bad_email'
    end
    when 'website' then case
      when value is null or value = '' then 'required'
      when length(value) > 500 then 'too_long'
      when value !~ '^(https?://)?([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(:[0-9]{2,5})?(/\S*)?$' then 'bad_website'
    end
    when 'address' then private.text_problem(value, 5, 300, 2)
    when 'contact_person' then case
      when position('@' in coalesce(value, '')) > 0 then 'has_at'
      else private.text_problem(value, 2, 100, 2)
    end
    when 'status_reason' then private.text_problem(value, 3, 500, 2)
    when 'status_source' then private.text_problem(value, 2, 500, 2)
    when 'identifier:company' then private.identifier_problem('company', value)
    when 'identifier:nonprofit' then private.identifier_problem('nonprofit', value)
    when 'identifier:vat_dealer' then private.identifier_problem('vat_dealer', value)
    when 'engagement_subject' then private.text_problem(value, 3, 500, 2)
    when 'amount' then case
      when value is null or value = '' then 'required'
      when replace(value, ',', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
        or replace(value, ',', '')::numeric <= 0 then 'bad_amount'
    end
    when 'exemption' then case
      when value is null or value = '' then 'required'
      when value !~ '^3\([0-9]+א?\)$' then 'bad_exemption'
    end
    when 'decision_note' then private.text_problem(value, 2, 2000, 2)
    when 'person_name' then private.text_problem(value, 2, 100, 2)
    when 'job_title' then private.text_problem(value, 2, 200, 2)
    when 'access_reason' then private.text_problem(value, 5, 1000, 2)
    when 'date' then case
      when value is null or value = '' then 'required'
      when not private.real_date(value) then 'bad_date'
      else private.date_problem(value::date,
        coalesce(today, (now() at time zone 'Asia/Jerusalem')::date))
    end
    else 'bad_choice'
  end;
end;
$$;

create function private.check_profile_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.signed_in_write() then return new; end if;
  if tg_op = 'INSERT' or new.first_name is distinct from old.first_name then
    perform private.raise_rule(private.rule_problem('person_name', new.first_name));
  end if;
  if tg_op = 'INSERT' or new.last_name is distinct from old.last_name then
    perform private.raise_rule(private.rule_problem('person_name', new.last_name));
  end if;
  if tg_op = 'INSERT' or new.job_title is distinct from old.job_title then
    perform private.raise_rule(private.rule_problem('job_title', new.job_title));
  end if;
  if (tg_op = 'INSERT' or new.phone is distinct from old.phone) and coalesce(new.phone, '') <> '' then
    perform private.raise_rule(private.rule_problem('phone', new.phone));
  end if;
  if tg_op = 'INSERT' or new.purpose is distinct from old.purpose then
    perform private.raise_rule(private.rule_problem('access_reason', new.purpose));
  end if;
  return new;
end;
$$;
revoke all on function private.check_profile_row() from public, anon;
create trigger check_profile_rules
  before insert or update of first_name, last_name, job_title, phone, purpose on public.profiles
  for each row execute function private.check_profile_row();

-- 2. An active user no longer edits their own details directly (decision 8): the change goes
-- through a request below. Someone still filling in an access request may edit it.
drop policy profiles_edit_own on public.profiles;
create policy profiles_edit_own on public.profiles for update to authenticated
  using ((select private.is_admin()) or (user_id = (select auth.uid()) and status = 'pending'))
  with check ((select private.is_admin()) or (user_id = (select auth.uid()) and status = 'pending'));

-- 3. Requests to change a role, the unit or one's own details.
create table public.access_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('add_role', 'remove_role', 'move_unit', 'details')),
  role text check (role in ('viewer', 'editor', 'unit_manager', 'admin', 'auditor')),
  unit_id uuid references public.org_units (id) on delete restrict,
  grant_id uuid references public.role_grants (id) on delete cascade,
  details jsonb,
  reason text not null check (length(reason) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (length(decision_note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (kind <> 'add_role' or (role is not null and (role in ('admin', 'auditor')) = (unit_id is null))),
  check (kind <> 'remove_role' or grant_id is not null),
  check (kind <> 'move_unit' or unit_id is not null),
  check (kind <> 'details' or jsonb_typeof(details) = 'object'),
  check (status <> 'rejected' or length(trim(coalesce(decision_note, ''))) >= 2),
  check ((status in ('approved', 'rejected')) = (decided_at is not null))
);
create index access_change_requests_user_idx on public.access_change_requests (user_id);
create index access_change_requests_unit_idx on public.access_change_requests (unit_id);
create index access_change_requests_grant_idx on public.access_change_requests (grant_id);
create index access_change_requests_decided_by_idx on public.access_change_requests (decided_by);
-- One open request of each kind per user.
create unique index access_change_requests_open_idx
  on public.access_change_requests (user_id, kind) where status = 'pending';
select private.track_table('public.access_change_requests', '{details,reason,decision_note}');

-- The unit a request is about: the new unit, the unit of the role, or the user's own unit.
create function private.change_unit(request public.access_change_requests)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    request.unit_id,
    (select g.unit_id from public.role_grants g where g.id = request.grant_id),
    (select p.unit_id from public.profiles p where p.user_id = request.user_id)
  );
$$;

-- An admin decides every request. A unit manager decides requests about their own unit, but
-- never a request for a manager, admin or auditor role, and never their own.
create function private.may_decide_change(request public.access_change_requests)
returns boolean language sql stable security definer set search_path = '' as $$
  select request.user_id <> auth.uid() and (
    private.is_admin()
    or (
      private.manages_unit(private.change_unit(request))
      and coalesce(
        request.role,
        (select g.role from public.role_grants g where g.id = request.grant_id),
        'viewer'
      ) in ('viewer', 'editor')
    )
  );
$$;
revoke all on function private.change_unit(public.access_change_requests),
  private.may_decide_change(public.access_change_requests) from public, anon;
grant execute on function private.change_unit(public.access_change_requests),
  private.may_decide_change(public.access_change_requests) to authenticated;

alter table public.access_change_requests enable row level security;
grant select on public.access_change_requests to authenticated;
create policy access_change_requests_read on public.access_change_requests for select
  to authenticated
  using (user_id = (select auth.uid()) or private.may_decide_change(access_change_requests));

-- Details a user may ask to change, checked with the same rules as the access form.
create function private.details_problem(details jsonb)
returns text language plpgsql stable set search_path = '' as $$
declare
  key text;
begin
  if jsonb_typeof(details) <> 'object' or details = '{}'::jsonb then return 'required'; end if;
  for key in select jsonb_object_keys(details) loop
    if key not in ('first_name', 'last_name', 'job_title', 'phone') then return 'bad_choice'; end if;
    if jsonb_typeof(details -> key) <> 'string' then return 'bad_choice'; end if;
  end loop;
  return coalesce(
    case when details ? 'first_name'
      then private.rule_problem('person_name', details ->> 'first_name') end,
    case when details ? 'last_name'
      then private.rule_problem('person_name', details ->> 'last_name') end,
    case when details ? 'job_title'
      then private.rule_problem('job_title', details ->> 'job_title') end,
    case when coalesce(details ->> 'phone', '') <> ''
      then private.rule_problem('phone', details ->> 'phone') end
  );
end;
$$;

-- 4. Asking. Only an active user, only for themselves.
create function public.request_access_change(
  change_kind text,
  why text,
  wanted_role text default null,
  target_unit uuid default null,
  target_grant uuid default null,
  new_details jsonb default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  request_id uuid;
begin
  if not exists (select 1 from public.profiles where user_id = me and status = 'active') then
    raise exception 'Only an active user may ask for a change' using errcode = '42501';
  end if;
  perform private.raise_rule(private.rule_problem('access_reason', why));
  if change_kind = 'details' then
    perform private.raise_rule(private.details_problem(new_details));
  elsif change_kind = 'remove_role' and not exists (
    select 1 from public.role_grants
    where id = target_grant and user_id = me and revoked_at is null
  ) then
    raise exception 'invalid:bad_choice' using errcode = '22023';
  elsif change_kind in ('add_role', 'move_unit') and target_unit is not null and not exists (
    select 1 from public.org_units where id = target_unit and active
  ) then
    raise exception 'invalid:bad_choice' using errcode = '22023';
  end if;
  insert into public.access_change_requests
    (user_id, kind, role, unit_id, grant_id, details, reason)
  values (
    me, change_kind,
    case when change_kind = 'add_role' then wanted_role end,
    case when change_kind in ('add_role', 'move_unit') then target_unit end,
    case when change_kind = 'remove_role' then target_grant end,
    case when change_kind = 'details' then new_details end,
    trim(why)
  )
  returning id into request_id;
  return request_id;
end;
$$;

create function public.cancel_access_change(request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.access_change_requests set status = 'cancelled', updated_at = now()
  where id = request_id and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Request not found' using errcode = '42501';
  end if;
end;
$$;

-- 5. Deciding: approval applies the change in the same transaction (decision 4).
create function private.apply_access_change(request public.access_change_requests)
returns void language plpgsql security definer set search_path = '' as $$
declare
  old_unit uuid;
  target public.role_grants;
begin
  case request.kind
  when 'add_role' then
    insert into public.role_grants (user_id, role, unit_id)
    values (request.user_id, request.role, request.unit_id)
    on conflict do nothing;
  when 'remove_role' then
    select * into target from public.role_grants
    where id = request.grant_id and revoked_at is null for update;
    if not found then
      raise exception 'The role was already removed' using errcode = '22023';
    end if;
    if target.role = 'admin' and not exists (
      select 1 from public.role_grants
      where role = 'admin' and revoked_at is null and id <> target.id
    ) then
      raise exception 'The last admin cannot be revoked' using errcode = '22023';
    end if;
    update public.role_grants set revoked_at = now() where id = target.id;
  when 'move_unit' then
    -- The viewer and editor roles move with the person; a manager role stays for an admin.
    select unit_id into old_unit from public.profiles where user_id = request.user_id;
    update public.profiles set unit_id = request.unit_id, updated_at = now()
    where user_id = request.user_id;
    insert into public.role_grants (user_id, role, unit_id)
    select request.user_id, g.role, request.unit_id from public.role_grants g
    where g.user_id = request.user_id and g.unit_id = old_unit and g.revoked_at is null
      and g.role in ('viewer', 'editor')
    on conflict do nothing;
    update public.role_grants set revoked_at = now()
    where user_id = request.user_id and unit_id = old_unit and revoked_at is null
      and role in ('viewer', 'editor') and old_unit is distinct from request.unit_id;
    if not exists (
      select 1 from public.role_grants
      where user_id = request.user_id and unit_id = request.unit_id and revoked_at is null
    ) then
      insert into public.role_grants (user_id, role, unit_id)
      values (request.user_id, 'viewer', request.unit_id);
    end if;
  when 'details' then
    update public.profiles set
      first_name = coalesce(request.details ->> 'first_name', first_name),
      last_name = coalesce(request.details ->> 'last_name', last_name),
      job_title = coalesce(request.details ->> 'job_title', job_title),
      phone = case when request.details ? 'phone'
        then nullif(trim(request.details ->> 'phone'), '') else phone end,
      updated_at = now()
    where user_id = request.user_id;
  end case;
end;
$$;
revoke all on function private.apply_access_change(public.access_change_requests),
  private.details_problem(jsonb) from public, anon;

create function public.decide_access_change(request_id uuid, approve boolean, note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  request public.access_change_requests;
begin
  select * into request from public.access_change_requests
  where id = request_id and status = 'pending' for update;
  if not found or not private.may_decide_change(request) then
    raise exception 'Request not found or not authorized' using errcode = '42501';
  end if;
  if not approve or coalesce(note, '') <> '' then
    perform private.raise_rule(private.rule_problem('decision_note', note));
  end if;
  if approve then perform private.apply_access_change(request); end if;
  update public.access_change_requests set
    status = case when approve then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = auth.uid(), decision_note = nullif(trim(note), ''),
    updated_at = now()
  where id = request_id;
end;
$$;

revoke all on function public.request_access_change(text, text, text, uuid, uuid, jsonb),
  public.cancel_access_change(uuid), public.decide_access_change(uuid, boolean, text)
  from public, anon;
grant execute on function public.request_access_change(text, text, text, uuid, uuid, jsonb),
  public.cancel_access_change(uuid), public.decide_access_change(uuid, boolean, text)
  to authenticated;

-- 6. The admin home counts change requests with the access requests (screens-spec 5).
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  admin boolean := private.is_admin();
  counters jsonb := '{}'::jsonb;
begin
  if admin or private.has_role(array['unit_manager']) then
    counters := counters || jsonb_build_object('users_pending',
      (select count(*) from public.profiles p
        where p.status = 'pending' and (admin or private.manages_unit(p.unit_id)))
      + (select count(*) from public.access_change_requests r
        where r.status = 'pending' and private.may_decide_change(r)));
  end if;
  if admin or private.has_role(array['editor', 'unit_manager']) then
    counters := counters || jsonb_build_object('identifiers_pending', (
      select count(*) from public.identifier_candidates where status = 'pending'));
  end if;
  if admin then
    counters := counters || jsonb_build_object(
      'categories_pending', (select count(*) from public.category_requests where status = 'pending'),
      'thresholds_pending', (select count(*) from public.threshold_proposals where status = 'pending'),
      'addresses_not_found', (select count(*) from public.address_checks where result = 'not_found'));
  end if;
  return counters;
end
$$;
