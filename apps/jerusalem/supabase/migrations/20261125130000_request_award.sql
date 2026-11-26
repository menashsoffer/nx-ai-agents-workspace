-- Stage C of the alignment review (25.11): a request ends with a winner. The unit picks one
-- supplier whose offer is open (its deadline passed), with an optional reason, and the
-- request is closed as 'awarded'. A request with no winner is still cancelled with a reason
-- (cancel_engagement_request). The supplier sees in its personal area whether it was chosen;
-- the others that answered see that they were not, without the winner or the amounts.

alter table public.engagement_requests
  drop constraint engagement_requests_status_check,
  add constraint engagement_requests_status_check check (status in (
    'draft', 'submitted', 'approved', 'rejected', 'cancelled', 'awarded', 'contracted')),
  add column awarded_approach_id uuid references public.supplier_approaches (id)
    on delete restrict,
  add column awarded_at timestamptz,
  add column awarded_by uuid references auth.users (id) on delete set null,
  add column award_note text check (length(award_note) <= 2000),
  add constraint engagement_requests_award_check
    check ((status = 'awarded') = (awarded_approach_id is not null)
      or (status = 'contracted' and awarded_approach_id is not null));
create index engagement_requests_award_idx on public.engagement_requests (awarded_approach_id);
create index engagement_requests_awarded_by_idx on public.engagement_requests (awarded_by);

-- An awarded request takes no more approaches or answers.
create or replace function private.request_closed(request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select r.status in ('cancelled', 'rejected', 'awarded', 'contracted')
    from public.engagement_requests r where r.id = request), true)
$$;

-- Picks the winner. Only an approach of this request whose current answer is an offer that
-- is no longer sealed can win. The caller must be an editor or manager of the unit, or admin.
create function public.award_engagement_request(request uuid, approach uuid,
  note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  target public.supplier_approaches;
  reason text := nullif(btrim(coalesce(note, '')), '');
begin
  perform private.require_request_editor(request);
  if private.request_closed(request) then
    perform private.raise_rule('request_closed');
  end if;
  if length(coalesce(reason, '')) > 2000 then
    raise exception 'reason:approach_award_note' using errcode = '22023';
  end if;
  select * into target from public.supplier_approaches a
  where a.id = approach and a.request_id = request for update;
  if target.id is null or private.approach_sealed(target) or not exists (
    select 1 from public.approach_responses x
    where x.approach_id = target.id and x.withdrawn_at is null and x.answer = 'offer') then
    raise exception 'reason:approach_award_offer' using errcode = '22023';
  end if;
  update public.engagement_requests set status = 'awarded', supplier_id = target.supplier_id,
    awarded_approach_id = target.id, awarded_at = now(), awarded_by = auth.uid(),
    award_note = reason
  where id = request;
end;
$$;
revoke all on function public.award_engagement_request(uuid, uuid, text) from public, anon;
grant execute on function public.award_engagement_request(uuid, uuid, text) to authenticated;

-- What the supplier learns about the end of a request: chosen, not chosen (only when it
-- answered with an offer), or nothing yet.
create function private.approach_result(a public.supplier_approaches,
  r public.engagement_requests)
returns text language sql stable set search_path = '' as $$
  select case
    when r.status not in ('awarded', 'contracted') then null
    when r.awarded_approach_id = a.id then 'selected'
    when exists (select 1 from public.approach_responses x where x.approach_id = a.id
      and x.withdrawn_at is null and x.answer = 'offer') then 'not_selected'
  end
$$;
revoke all on function private.approach_result(public.supplier_approaches,
  public.engagement_requests) from public, anon, authenticated;

create or replace function public.portal_approaches(supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.portal_role(supplier_id) is null then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'subject', r.subject,
      'unit_name', u.name, 'approached_on', a.approached_on, 'respond_by', a.respond_by,
      'needed_by', r.needed_by, 'cancelled', r.status in ('cancelled', 'rejected'),
      'open', private.approach_sealed(a) and not private.request_closed(r.id),
      'result', private.approach_result(a, r),
      'answer', (select private.response_json(x) from public.approach_responses x
        where x.approach_id = a.id order by x.created_at desc limit 1))
      order by a.respond_by desc, a.created_at desc)
    from public.supplier_approaches a
    join public.engagement_requests r on r.id = a.request_id
    join public.org_units u on u.id = r.unit_id
    where a.supplier_id = portal_approaches.supplier_id and a.respond_by is not null),
    '[]'::jsonb);
end;
$$;

-- Requests of the caller's units that wait for a winner: open, with at least one open offer,
-- and no approach still before its deadline. Shown in "מחכה לך" on the home screen.
create function private.requests_to_award(admin boolean)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.engagement_requests r
  where r.status in ('draft', 'submitted', 'approved')
    and (admin or private.in_unit(r.unit_id, array['editor', 'unit_manager']))
    and exists (select 1 from public.supplier_approaches a
      join public.approach_responses x on x.approach_id = a.id
      where a.request_id = r.id and x.withdrawn_at is null and x.answer = 'offer')
    and not exists (select 1 from public.supplier_approaches a
      where a.request_id = r.id and private.approach_sealed(a))
$$;
revoke all on function private.requests_to_award(boolean) from public, anon, authenticated;

create or replace function public.home_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  admin boolean := private.is_admin();
  result jsonb;
begin
  if not (admin or private.is_member()) then
    raise exception 'Only active members see the overview' using errcode = '42501';
  end if;
  result := jsonb_build_object(
    'active_suppliers', (select count(*) from public.suppliers where status = 'active'),
    'registries', (select count(*) from public.registries where status = 'active'),
    'memberships', (select count(*) from public.memberships where review_status <> 'rejected'),
    'memberships_verified', (select count(*) from public.memberships
      where review_status = 'verified'),
    'suppliers_identified', (select count(distinct i.supplier_id)
      from public.supplier_identifiers i
      join public.suppliers s on s.id = i.supplier_id and s.status = 'active'
      where i.review_status = 'verified'),
    'my_open_requests', (select count(*) from public.engagement_requests e
      where e.status in ('draft', 'submitted', 'approved')
        and (admin or private.in_unit(e.unit_id))),
    'requests_to_award', private.requests_to_award(admin),
    'lapsed', private.lapsed_registrations(private.israel_today()));
  if admin then
    result := result || jsonb_build_object(
      'kind_suggestions_pending', (select count(*) from public.kind_suggestions
        where status = 'pending'),
      'registries_without_unit', (select count(*) from public.registries
        where status = 'active' and owner_unit_id is null));
  end if;
  return result;
end
$$;
