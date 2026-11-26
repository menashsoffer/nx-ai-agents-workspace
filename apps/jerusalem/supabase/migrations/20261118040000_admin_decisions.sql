-- Two decisions Menash made on 18.11.2026 (screens-spec 7 and 9):
-- 1. Supplier ID candidates are reviewed by an administrator only.
-- 2. Rejecting a monthly threshold proposal needs a reason, kept with the proposal.

-- 1. Candidates: read and decide by an administrator only.
drop policy identifier_candidates_read on public.identifier_candidates;
create policy identifier_candidates_read on public.identifier_candidates for select
  to authenticated using ((select private.is_admin()));

create or replace function public.decide_identifier_candidate(candidate uuid, accept boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.identifier_candidates;
  new_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into c from public.identifier_candidates where id = candidate for update;
  if not found or c.status <> 'pending' then
    raise exception 'No pending candidate with this id' using errcode = 'P0002';
  end if;
  if accept then
    begin
      insert into public.supplier_identifiers (supplier_id, scheme, value, source,
        registrar_name, registrar_status, checked_at)
      values (c.supplier_id, c.scheme, c.value, c.source, c.registrar_name,
        c.registrar_status, c.found_at)
      returning id into new_id;
    exception when unique_violation then
      raise exception 'This number already belongs to another supplier' using errcode = '23505';
    end;
  end if;
  update public.identifier_candidates
  set status = case when accept then 'accepted' else 'dismissed' end,
    decided_at = now(), decided_by = auth.uid(), identifier_id = new_id
  where id = candidate;
  return new_id;
end
$$;

-- The home-screen counters follow the same rule.
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
  if admin then
    counters := counters || jsonb_build_object(
      'identifiers_pending', (select count(*) from public.identifier_candidates
        where status = 'pending'),
      'categories_pending', (select count(*) from public.category_requests where status = 'pending'),
      'thresholds_pending', (select count(*) from public.threshold_proposals where status = 'pending'),
      'addresses_not_found', (select count(*) from public.address_checks where result = 'not_found'));
  end if;
  return counters;
end
$$;

-- 2. Thresholds: a reason on rejection (rule decision_note), optional on approval.
alter table public.threshold_proposals
  add column decision_note text check (length(decision_note) <= 2000);

drop function public.decide_threshold_proposal(uuid, boolean);
create function public.decide_threshold_proposal(
  proposal uuid, approve boolean, note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.threshold_proposals;
  new_id uuid;
begin
  if not (private.is_admin() or (auth.uid() is null and session_user = 'postgres')) then
    raise exception 'Not authorized to decide thresholds' using errcode = '42501';
  end if;
  select * into p from public.threshold_proposals where id = proposal for update;
  if not found or p.status <> 'pending' then
    raise exception 'No pending proposal with this id' using errcode = 'P0002';
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
$$;

revoke all on function public.decide_threshold_proposal(uuid, boolean, text) from public, anon;
grant execute on function public.decide_threshold_proposal(uuid, boolean, text) to authenticated;
