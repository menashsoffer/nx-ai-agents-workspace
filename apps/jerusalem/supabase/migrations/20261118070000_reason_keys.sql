-- Error handling stage B (documentation/error-handling-spec-he.md section 6).
-- Refusals a person can meet from the site now carry a key, `reason:<key>`, instead of an
-- English sentence the site could not show. The SQLSTATE codes do not change, so PostgREST
-- answers with the same HTTP status as before (404 still means "already decided, refresh").
-- web/src/lib/errors/reasons.ts holds the Hebrew text for every key, and
-- web/src/lib/errors/tests/reasons-contract-test.ts checks that both sides list the same keys.
-- The functions below are copied from their latest definitions; only the messages changed.

-- decide_category_request(uuid,text,text,uuid)
CREATE OR REPLACE FUNCTION public.decide_category_request(request_id uuid, decision text, note text, category_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  request public.category_requests;
  resolved uuid := category_id;
begin
  if not private.is_admin() then
    raise exception 'Only an admin decides category requests' using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved', 'rejected', 'linked') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  select * into request from public.category_requests
  where id = request_id and status = 'pending'
  for update;
  if not found then
    -- P0002 arrives as 404, so the site knows to refresh the list.
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
  if decision = 'rejected' and length(btrim(coalesce(note, ''))) < 2 then
    raise exception 'reason:reason_required' using errcode = '22023';
  end if;
  if decision = 'linked' and not exists (
    select 1 from public.categories where id = category_id and active
  ) then
    raise exception 'reason:choose_active_category' using errcode = '22023';
  end if;
  if decision = 'approved' then
    insert into public.categories (name, description, parent_id)
    values (request.proposed_name, request.description, request.parent_id)
    returning id into resolved;
  elsif decision = 'rejected' then
    resolved := null;
  end if;
  update public.category_requests
  set status = decision, decided_by = auth.uid(), decided_at = now(),
    decision_note = note, resolved_category_id = resolved
  where id = request_id;
  return resolved;
end;
$function$;

-- decide_identifier_candidate(uuid,boolean)
CREATE OR REPLACE FUNCTION public.decide_identifier_candidate(candidate uuid, accept boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.identifier_candidates;
  new_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into c from public.identifier_candidates where id = candidate for update;
  if not found or c.status <> 'pending' then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
  if accept then
    begin
      insert into public.supplier_identifiers (supplier_id, scheme, value, source,
        registrar_name, registrar_status, checked_at)
      values (c.supplier_id, c.scheme, c.value, c.source, c.registrar_name,
        c.registrar_status, c.found_at)
      returning id into new_id;
    exception when unique_violation then
      raise exception 'reason:identifier_taken' using errcode = '23505';
    end;
  end if;
  update public.identifier_candidates
  set status = case when accept then 'accepted' else 'dismissed' end,
    decided_at = now(), decided_by = auth.uid(), identifier_id = new_id
  where id = candidate;
  return new_id;
end
$function$;

-- decide_threshold_proposal(uuid,boolean,text)
CREATE OR REPLACE FUNCTION public.decide_threshold_proposal(proposal uuid, approve boolean, note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p public.threshold_proposals;
  new_id uuid;
begin
  if not (private.is_admin() or (auth.uid() is null and session_user = 'postgres')) then
    raise exception 'Not authorized to decide thresholds' using errcode = '42501';
  end if;
  select * into p from public.threshold_proposals where id = proposal for update;
  if not found or p.status <> 'pending' then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
  if not approve or coalesce(note, '') <> '' then
    perform private.raise_rule(private.rule_problem('decision_note', note));
  end if;
  if approve then
    insert into public.thresholds (valid_from, valid_until, no_tender_max, zuta4_max,
      zuta6_max, index_value, source, is_official, created_by)
    values (p.valid_from, (p.valid_from + interval '1 month' - interval '1 day')::date,
      p.no_tender_max, p.zuta4_max, p.zuta6_max, p.index_value, p.source, false, auth.uid())
    returning id into new_id;
  end if;
  update public.threshold_proposals
  set status = case when approve then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = auth.uid(), threshold_id = new_id,
    decision_note = nullif(trim(note), '')
  where id = proposal;
  return new_id;
end
$function$;

-- grant_role(uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.grant_role(target_user uuid, wanted_role text, target_unit uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  grant_id uuid;
begin
  if not (private.is_admin()
    or (wanted_role in ('viewer', 'editor') and private.manages_unit(target_unit))) then
    raise exception 'Not authorized to grant this role' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles where user_id = target_user and status = 'active'
  ) then
    raise exception 'reason:no_active_profile' using errcode = '22023';
  end if;
  insert into public.role_grants (user_id, role, unit_id)
  values (target_user, wanted_role, target_unit)
  returning id into grant_id;
  return grant_id;
end;
$function$;

-- private.apply_access_change(access_change_requests)
CREATE OR REPLACE FUNCTION private.apply_access_change(request access_change_requests)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      raise exception 'reason:role_already_removed' using errcode = '22023';
    end if;
    if target.role = 'admin' and not exists (
      select 1 from public.role_grants
      where role = 'admin' and revoked_at is null and id <> target.id
    ) then
      raise exception 'reason:last_admin' using errcode = '22023';
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
$function$;

-- private.guard_verification()
CREATE OR REPLACE FUNCTION private.guard_verification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.review_status = 'verified'
    and (tg_op = 'INSERT' or old.review_status is distinct from 'verified') then
    if auth.uid() is not null and not private.has_role(array['unit_manager']) then
      raise exception 'Only a unit manager or an admin can verify' using errcode = '42501';
    end if;
    if auth.uid() is not null and auth.uid() = new.created_by then
      raise exception 'reason:self_verification'
        using errcode = '42501';
    end if;
    new.verified_by := coalesce(auth.uid(), new.verified_by);
    new.verified_at := now();
  elsif new.review_status <> 'verified' then
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$function$;

-- private.require_active_supplier()
CREATE OR REPLACE FUNCTION private.require_active_supplier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = new.supplier_id and s.status = 'active'
  ) then
    raise exception 'reason:supplier_inactive' using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- record_threshold(numeric,date,text)
CREATE OR REPLACE FUNCTION public.record_threshold(index_on_1985_base numeric, starts_on date, index_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  new_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Not authorized to record thresholds' using errcode = '42501';
  end if;
  if index_on_1985_base is null or index_on_1985_base <= 0 then
    raise exception 'The index must be positive' using errcode = '22023';
  end if;
  if extract(day from starts_on) <> 16 then
    raise exception 'reason:threshold_start_day' using errcode = '22023';
  end if;
  insert into public.thresholds (valid_from, valid_until, no_tender_max, zuta4_max,
    zuta6_max, index_value, source, is_official)
  select starts_on, (starts_on + interval '1 month' - interval '1 day')::date,
    c.no_tender_max, c.zuta4_max, c.zuta6_max, index_on_1985_base, index_source, false
  from public.calculate_thresholds(index_on_1985_base) c
  returning id into new_id;
  return new_id;
end
$function$;

-- rename_supplier(jsonb)
CREATE OR REPLACE FUNCTION public.rename_supplier(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  new_name text := nullif(trim(payload ->> 'display_name'), '');
  previous_name text;
begin
  if jsonb_typeof(payload) <> 'object' or payload - array['supplier_id', 'display_name'] <> '{}'::jsonb
    or supplier is null or new_name is null then
    raise exception 'Invalid supplier name' using errcode = '22023';
  end if;
  select s.display_name into previous_name from public.suppliers s
    where s.id = supplier and s.status = 'active' for update;
  if previous_name is null then raise exception 'reason:supplier_unavailable' using errcode = '22023'; end if;
  if previous_name = new_name then return supplier; end if;
  update public.suppliers set display_name = new_name, review_status = 'needs_review' where id = supplier;
  if not found then raise exception 'Not permitted to edit supplier' using errcode = '42501'; end if;
  if previous_name <> new_name then
    insert into public.supplier_names (supplier_id, name, kind)
    values (supplier, previous_name, 'former_name') on conflict do nothing;
  end if;
  return supplier;
end;
$function$;

-- revoke_role(uuid)
CREATE OR REPLACE FUNCTION public.revoke_role(grant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.role_grants;
begin
  select * into target from public.role_grants
  where id = grant_id and revoked_at is null
  for update;
  if not found or not (private.is_admin()
    or (target.role in ('viewer', 'editor') and private.manages_unit(target.unit_id))) then
    raise exception 'Grant not found or not authorized' using errcode = '42501';
  end if;
  if target.role = 'admin' and not exists (
    select 1 from public.role_grants
    where role = 'admin' and revoked_at is null and id <> grant_id
  ) then
    raise exception 'reason:last_admin' using errcode = '22023';
  end if;
  update public.role_grants set revoked_at = now() where id = grant_id;
end;
$function$;

-- save_supplier_membership(jsonb)
CREATE OR REPLACE FUNCTION public.save_supplier_membership(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  version uuid := nullif(payload ->> 'registry_version_id', '')::uuid;
  field uuid := nullif(payload ->> 'registry_field_id', '')::uuid;
  official_number text := nullif(trim(payload ->> 'identifier'), '');
  identifier_scheme text := nullif(payload ->> 'identifier_scheme', '');
  matching_supplier uuid;
  registry uuid;
  unit uuid;
  contact text;
begin
  if jsonb_typeof(payload) <> 'object' or payload - array[
    'supplier_id', 'display_name', 'entity_kind', 'registry_version_id', 'registry_field_id',
    'registered_from', 'registered_until', 'engagement_started_on', 'identifier',
    'identifier_scheme', 'phone', 'email'
  ] <> '{}'::jsonb then
    raise exception 'Invalid supplier input' using errcode = '22023';
  end if;
  select v.registry_id, r.owner_unit_id into registry, unit
  from public.registry_versions v join public.registries r on r.id = v.registry_id
  where v.id = version;
  if registry is null or field is null or not exists (
    select 1 from public.registry_fields f where f.id = field and f.registry_id = registry
  ) then
    raise exception 'Registry version and field do not match' using errcode = '22023';
  end if;
  if not (select private.is_admin()) and (unit is null
    or not private.has_role(array['editor', 'unit_manager'], unit)) then
    raise exception 'Not permitted in this registry' using errcode = '42501';
  end if;
  if supplier is not null and not exists (
    select 1 from public.suppliers s where s.id = supplier and s.status = 'active'
  ) then
    raise exception 'reason:supplier_unavailable' using errcode = '22023';
  end if;
  if (official_number is null) <> (identifier_scheme is null)
    or (identifier_scheme is not null and identifier_scheme not in ('company', 'nonprofit', 'vat_dealer')) then
    raise exception 'Invalid identifier' using errcode = '22023';
  end if;
  if official_number is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(official_number, 0));
    if exists (
      select 1 from public.supplier_identifiers i
      where i.value = official_number and i.scheme <> 'personal_id'
        and i.review_status <> 'rejected' and i.supplier_id is distinct from supplier
    ) then
      raise exception 'reason:identifier_taken' using errcode = '23505';
    end if;
    select i.supplier_id into matching_supplier from public.supplier_identifiers i
    where i.value = official_number and i.scheme <> 'personal_id' and i.review_status <> 'rejected'
    limit 1;
  end if;
  if supplier is null then
    insert into public.suppliers (display_name, entity_kind)
    values (trim(payload ->> 'display_name'), coalesce(nullif(payload ->> 'entity_kind', ''), 'unknown'))
    returning id into supplier;
  end if;
  if official_number is not null and matching_supplier is null then
    insert into public.supplier_identifiers (supplier_id, scheme, value)
    values (supplier, identifier_scheme, official_number);
  end if;
  insert into public.memberships (supplier_id, registry_version_id, registry_field_id,
    registered_from, registered_until, engagement_started_on, dates_source)
  values (supplier, version, field, nullif(payload ->> 'registered_from', '')::date,
    nullif(payload ->> 'registered_until', '')::date,
    nullif(payload ->> 'engagement_started_on', '')::date, 'internal_registry');
  foreach contact in array array['phone', 'email'] loop
    if nullif(trim(payload ->> contact), '') is not null then
      insert into public.supplier_contacts (supplier_id, kind, value)
      values (supplier, contact, trim(payload ->> contact)) on conflict do nothing;
    end if;
  end loop;
  return supplier;
end;
$function$;

-- set_supplier_status(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.set_supplier_status(target uuid, change jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inactive boolean;
begin
  if not private.is_admin() then
    raise exception 'Only an admin changes a supplier status' using errcode = '42501';
  end if;
  if jsonb_typeof(change -> 'active') is distinct from 'boolean' then
    raise exception 'active must be true or false' using errcode = '22023';
  end if;
  inactive := not (change ->> 'active')::boolean;
  update public.suppliers set
    status = case when inactive then 'inactive' else 'active' end,
    status_reason = case when inactive then nullif(trim(change ->> 'reason'), '') end,
    status_source = case when inactive then nullif(trim(change ->> 'source'), '') end,
    status_changed_on = case when inactive then (change ->> 'changedOn')::date end,
    updated_at = now()
  where id = target and status <> 'merged';
  if not found then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
end;
$function$;
