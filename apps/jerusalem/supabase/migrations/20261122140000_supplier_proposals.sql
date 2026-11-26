-- Supplier personal area, stage 2 (supplier-portal-spec-he.md 6.3, 6.4, 7.1, decision 4).
-- A linked supplier proposes a fix to its own name, kind or a contact. The proposal goes
-- through the checks of supplier-edit-checks-spec-he.md and always waits for staff. The
-- supplier never sees the checks: they can name other suppliers.

alter table public.supplier_change_requests
  add column origin text not null default 'staff' check (origin in ('staff', 'supplier')),
  add column account_id uuid references public.supplier_accounts (id) on delete set null;
create index supplier_change_requests_account_idx on public.supplier_change_requests (account_id);

-- The requester reads their own row only for a staff change; a supplier reads its
-- proposals through portal_changes, without the checks.
drop policy supplier_change_requests_read on public.supplier_change_requests;
create policy supplier_change_requests_read on public.supplier_change_requests for select
  to authenticated using (
    (created_by = (select auth.uid()) and origin = 'staff')
    or (select private.is_admin())
    or (select private.is_auditor())
    or (change_kind = 'contact' and (select private.has_role(array['editor', 'unit_manager'])))
  );

-- The supplier a proposal is for: the input shape, and an active link of the caller to it.
create function private.portal_change_target(change jsonb)
returns public.suppliers language plpgsql stable security definer set search_path = '' as $$
declare
  s public.suppliers;
begin
  if jsonb_typeof(change) is distinct from 'object'
    or change - array['supplier_id', 'kind', 'value', 'contact_kind', 'contact_id', 'reason']
      <> '{}'::jsonb
    or coalesce(change ->> 'kind', '') not in ('rename', 'entity_kind', 'contact')
    or jsonb_typeof(change -> 'value') is distinct from 'string'
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

-- Decision 4: a supplier's change always waits. A red check refuses it without saying why,
-- since the reason may be another supplier. A rename needs a reason.
create function public.portal_propose_change(change jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.suppliers;
  checks jsonb;
  reason text := nullif(trim(change ->> 'reason'), '');
  contact uuid;
  r public.supplier_change_requests;
begin
  perform private.require_portal_caller();
  s := private.portal_change_target(change);
  contact := nullif(change ->> 'contact_id', '')::uuid;
  checks := private.supplier_change_checks(s, change);
  if private.change_outcome(checks) = 'red' then
    raise exception 'reason:proposal_blocked' using errcode = '22023';
  end if;
  if (reason is not null or change ->> 'kind' = 'rename')
    and private.text_problem(reason, 3, 500, 2) is not null then
    raise exception 'reason:change_reason_required' using errcode = '22023';
  end if;
  if exists (select 1 from public.supplier_change_requests p where p.supplier_id = s.id
    and p.origin = 'supplier' and p.status = 'pending' and p.change_kind = change ->> 'kind'
    and p.contact_id is not distinct from contact
    and p.contact_kind is not distinct from nullif(change ->> 'contact_kind', '')) then
    raise exception 'reason:proposal_pending' using errcode = '23505';
  end if;
  if not private.take_quota('portal_change', 20, interval '1 day') then
    raise exception 'reason:too_many_attempts' using errcode = '54000';
  end if;
  insert into public.supplier_change_requests (supplier_id, change_kind, contact_kind,
    contact_id, old_value, new_value, reason, checks, outcome, status, origin, account_id)
  values (s.id, change ->> 'kind', nullif(change ->> 'contact_kind', ''), contact,
    private.change_old_value(s, change ->> 'kind', contact), trim(change ->> 'value'), reason,
    checks, private.change_outcome(checks), 'pending', 'supplier',
    (select a.id from public.supplier_accounts a where a.user_id = auth.uid()
      and a.supplier_id = s.id and a.status = 'active'))
  returning * into r;
  return jsonb_build_object('request_id', r.id, 'status', r.status);
end;
$$;

-- "הבקשות שלי" (spec 6.3): every proposal of the supplier, newest first, without the checks.
create function public.portal_changes(supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.portal_role(supplier_id) is null then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.change_kind,
      'contact_kind', r.contact_kind, 'old_value', r.old_value, 'new_value', r.new_value,
      'status', r.status, 'decision_note', r.decision_note, 'created_at', r.created_at,
      'decided_at', r.decided_at, 'mine', r.created_by = auth.uid())
      order by r.created_at desc, r.id)
    from public.supplier_change_requests r
    where r.supplier_id = portal_changes.supplier_id and r.origin = 'supplier'), '[]'::jsonb);
end;
$$;

-- The supplier's file now carries each contact's id, so a proposal can name the one it fixes.
create or replace function public.portal_supplier(supplier_id uuid)
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
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind,
      'value', c.value) order by c.kind, c.value) from public.supplier_contacts c
      where c.supplier_id = s.id and c.status = 'current'), '[]'::jsonb),
    'memberships', private.portal_memberships(s.id));
end;
$$;

revoke all on function private.portal_change_target(jsonb) from public, anon, authenticated;
revoke all on function public.portal_propose_change(jsonb), public.portal_changes(uuid)
  from public, anon;
grant execute on function public.portal_propose_change(jsonb), public.portal_changes(uuid)
  to authenticated;
