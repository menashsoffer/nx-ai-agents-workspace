-- Access to engagement data: thresholds are shared reference data, everything
-- else is visible to the owning unit and to admins.

create function private.request_unit(target uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select unit_id from public.engagement_requests where id = target
$$;

create function private.contract_unit(target uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select unit_id from public.contracts where id = target
$$;

-- A unit role at any level; the narrower roles are listed per policy.
create function private.in_unit(target_unit uuid, wanted text[] default array[
  'viewer', 'editor', 'unit_manager'
])
returns boolean
language sql
stable
set search_path = ''
as $$
  select target_unit is not null and private.has_role(wanted, target_unit)
$$;

revoke all on function private.request_unit(uuid), private.contract_unit(uuid),
  private.in_unit(uuid, text[]) from public, anon;
grant execute on function private.request_unit(uuid), private.contract_unit(uuid),
  private.in_unit(uuid, text[]) to authenticated;

alter table public.thresholds enable row level security;
alter table public.engagement_requests enable row level security;
alter table public.route_checks enable row level security;
alter table public.supplier_approaches enable row level security;
alter table public.contracts enable row level security;
alter table public.committee_decisions enable row level security;
alter table public.contract_changes enable row level security;
revoke all on public.thresholds, public.engagement_requests, public.route_checks,
  public.supplier_approaches, public.contracts, public.committee_decisions,
  public.contract_changes from public, anon, authenticated;

grant select on public.thresholds to authenticated;
create policy thresholds_read on public.thresholds for select to authenticated
  using ((select private.is_member()));

grant select on public.engagement_requests to authenticated;
grant insert (unit_id, subject, subject_key, estimated_value, value_includes_vat,
  requested_exemption, facts, supplier_id, membership_id, needed_by),
  update (subject, subject_key, estimated_value, value_includes_vat, requested_exemption,
  facts, supplier_id, membership_id, needed_by, status)
  on public.engagement_requests to authenticated;
create policy engagement_requests_read on public.engagement_requests for select
  to authenticated using (private.in_unit(unit_id) or (select private.is_admin()));
create policy engagement_requests_insert on public.engagement_requests for insert
  to authenticated with check (
    private.in_unit(unit_id, array['editor', 'unit_manager']) and status = 'draft'
  );
-- Editors keep a request moving; approval and rejection belong to the unit manager.
create policy engagement_requests_update on public.engagement_requests for update
  to authenticated
  using (private.in_unit(unit_id, array['editor', 'unit_manager']))
  with check (
    private.in_unit(unit_id, array['unit_manager'])
    or (private.in_unit(unit_id, array['editor'])
      and status in ('draft', 'submitted', 'cancelled'))
  );

-- Route checks are written only by the route-check Edge Function (service role).
grant select on public.route_checks to authenticated;
create policy route_checks_read on public.route_checks for select to authenticated
  using (private.in_unit(private.request_unit(request_id)) or (select private.is_admin()));

grant select on public.supplier_approaches to authenticated;
grant insert (request_id, supplier_id, approached_on, channel, responded, offer_amount,
  offer_includes_vat, note),
  update (responded, offer_amount, offer_includes_vat, note)
  on public.supplier_approaches to authenticated;
create policy supplier_approaches_read on public.supplier_approaches for select
  to authenticated
  using (private.in_unit(private.request_unit(request_id)) or (select private.is_admin()));
create policy supplier_approaches_insert on public.supplier_approaches for insert
  to authenticated with check (
    private.in_unit(private.request_unit(request_id), array['editor', 'unit_manager'])
  );
create policy supplier_approaches_update on public.supplier_approaches for update
  to authenticated
  using (private.in_unit(private.request_unit(request_id), array['editor', 'unit_manager']))
  with check (
    private.in_unit(private.request_unit(request_id), array['editor', 'unit_manager'])
  );

grant select on public.contracts to authenticated;
grant insert (unit_id, supplier_id, request_id, contract_number, subject, starts_on, ends_on,
  original_value, value_includes_vat, status),
  update (contract_number, subject, ends_on, status)
  on public.contracts to authenticated;
create policy contracts_read on public.contracts for select to authenticated
  using (private.in_unit(unit_id) or (select private.is_admin()));
create policy contracts_insert on public.contracts for insert to authenticated
  with check (private.in_unit(unit_id, array['unit_manager']));
create policy contracts_update on public.contracts for update to authenticated
  using (private.in_unit(unit_id, array['unit_manager']))
  with check (private.in_unit(unit_id, array['unit_manager']));

grant select on public.committee_decisions to authenticated;
grant insert (committee, request_id, contract_id, decided_on, decision, regulation, reasoning,
  published_on, source_document_id)
  on public.committee_decisions to authenticated;
create policy committee_decisions_read on public.committee_decisions for select
  to authenticated using (
    private.in_unit(coalesce(private.request_unit(request_id), private.contract_unit(contract_id)))
    or (select private.is_admin())
  );
create policy committee_decisions_insert on public.committee_decisions for insert
  to authenticated with check (
    private.in_unit(coalesce(private.request_unit(request_id),
      private.contract_unit(contract_id)), array['unit_manager'])
  );

grant select on public.contract_changes to authenticated;
grant insert (contract_id, kind, amount, months, item_description, decision_id, regulation,
  effective_on)
  on public.contract_changes to authenticated;
create policy contract_changes_read on public.contract_changes for select to authenticated
  using (private.in_unit(private.contract_unit(contract_id)) or (select private.is_admin()));
create policy contract_changes_insert on public.contract_changes for insert to authenticated
  with check (private.in_unit(private.contract_unit(contract_id), array['unit_manager']));
