-- Supplier edit checks, stage 4 (documentation/supplier-edit-checks-spec-he.md, section 3).
-- A supplier whose kind is unknown gets a suggested kind with the reasons for it. A person
-- accepts or rejects it; accepting sends an ordinary kind change through
-- submit_supplier_change, so the checks and approvals of stage 1 still apply. Suggestions
-- are made only when an admin runs suggest_supplier_kinds (decision 5): nothing changes here.

create table public.kind_suggestions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  suggested_kind text not null check (suggested_kind in (
    'company', 'sole_trader', 'nonprofit', 'partnership', 'cooperative', 'public_body')),
  strength text not null check (strength in ('strong', 'medium')),
  reasons jsonb not null
    check (jsonb_typeof(reasons) = 'array' and jsonb_array_length(reasons) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'outdated')),
  request_id uuid references public.supplier_change_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz
);
create unique index kind_suggestions_pending_idx on public.kind_suggestions (supplier_id)
  where status = 'pending';
create index kind_suggestions_request_idx on public.kind_suggestions (request_id);
create index kind_suggestions_created_by_idx on public.kind_suggestions (created_by);
create index kind_suggestions_decided_by_idx on public.kind_suggestions (decided_by);

alter table public.kind_suggestions enable row level security;
revoke all on public.kind_suggestions from public, anon, authenticated;
grant select on public.kind_suggestions to authenticated;
create policy kind_suggestions_read on public.kind_suggestions for select to authenticated
  using ((select private.is_admin()) or (select private.is_auditor())
    or (select private.has_role(array['editor', 'unit_manager'])));

-- The kind a registry's corporation type names: the registrar's "סוג תאגיד" for a company
-- number, GuideStar's malkarType for a nonprofit number.
create function private.registry_kind(details jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when details ->> 'malkarType' ~ 'חל["״]צ' then 'company'
    when details ->> 'malkarType' ~ 'עמותה|הקדש' then 'nonprofit'
    when details ->> 'סוג תאגיד' ~ 'אגודה' then 'cooperative'
    when details ->> 'סוג תאגיד' ~ 'שותפות' then 'partnership'
    when details ->> 'סוג תאגיד' ~ 'חברה|חברת' then 'company'
  end;
$$;

-- The kind a number suggests. The prefix is a hint only (spec section 2): 50 a public body,
-- 55 a partnership, 57 a cooperative, 58 a nonprofit; otherwise the number's scheme.
create function private.number_kind(scheme text, value text)
returns text language sql immutable set search_path = '' as $$
  select case
    when scheme in ('personal_id', 'vat_dealer') then 'sole_trader'
    when left(value, 2) = '50' then 'public_body'
    when left(value, 2) = '55' then 'partnership'
    when left(value, 2) = '57' then 'cooperative'
    when left(value, 2) = '58' then 'nonprofit'
    else scheme
  end;
$$;

-- Spec section 3: a verified number with a corporation type from the registry is strong;
-- a waiting number or the supplier's own name is medium. Two medium hints that disagree
-- suggest nothing.
create function private.suggested_kind(s public.suppliers)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  strong record;
  hints jsonb;
  kinds text[];
begin
  select private.registry_kind(i.registry_details) as kind, i.scheme, i.value into strong
  from public.supplier_identifiers i
  where i.supplier_id = s.id and i.review_status = 'verified'
    and private.registry_kind(i.registry_details) is not null
  order by i.verified_at desc nulls last limit 1;
  if found then
    return jsonb_build_object('kind', strong.kind, 'strength', 'strong', 'reasons',
      jsonb_build_array(jsonb_build_object('source', 'registry', 'scheme', strong.scheme,
        'value', strong.value, 'kind', strong.kind)));
  end if;
  select coalesce(jsonb_agg(hint), '[]') into hints from (
    select jsonb_build_object('source', 'identifier', 'scheme', i.scheme, 'value', i.value,
      'kind', private.number_kind(i.scheme, i.value)) as hint
    from public.supplier_identifiers i
    where i.supplier_id = s.id and i.review_status = 'needs_review'
    union all
    select jsonb_build_object('source', 'name', 'kind', private.kind_hint(s.display_name))
    where private.kind_hint(s.display_name) is not null
  ) found_hints;
  kinds := array(select distinct h ->> 'kind' from jsonb_array_elements(hints) h);
  if cardinality(kinds) <> 1 or kinds[1] = 'conflict' then return null; end if;
  return jsonb_build_object('kind', kinds[1], 'strength', 'medium', 'reasons', hints);
end;
$$;

-- Admin only. Suggests a kind for every active supplier whose kind is unknown, unless it
-- already has a waiting suggestion or a person rejected the same kind before.
create function public.suggest_supplier_kinds()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  created integer;
  unknown integer;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = 'PT403';
  end if;
  with candidates as (
    select s.id, private.suggested_kind(s) as suggestion
    from public.suppliers s
    where s.status = 'active' and s.entity_kind = 'unknown'
      and not exists (select 1 from public.kind_suggestions k
        where k.supplier_id = s.id and k.status = 'pending')
  ), inserted as (
    insert into public.kind_suggestions (supplier_id, suggested_kind, strength, reasons,
      created_by)
    select c.id, c.suggestion ->> 'kind', c.suggestion ->> 'strength', c.suggestion -> 'reasons',
      auth.uid()
    from candidates c
    where c.suggestion is not null and not exists (select 1 from public.kind_suggestions k
      where k.supplier_id = c.id and k.status = 'rejected'
        and k.suggested_kind = c.suggestion ->> 'kind')
    returning 1
  )
  select count(*) into created from inserted;
  select count(*) into unknown from public.suppliers
  where status = 'active' and entity_kind = 'unknown';
  return jsonb_build_object('created', created, 'unknown', unknown);
end;
$$;

-- The reason stored on the kind change, in the words the supplier's history shows.
create function private.suggestion_reason(k public.kind_suggestions)
returns text language sql immutable set search_path = '' as $$
  select left('הצעת סוג אוטומטית לפי ' || string_agg(case r ->> 'source'
      when 'registry' then 'סוג התאגיד במרשם'
      -- The number itself stays out: a reason may not repeat a digit five times.
      when 'identifier' then case r ->> 'scheme' when 'company' then 'ח"פ ממתין'
        when 'nonprofit' then 'מספר עמותה ממתין' else 'מספר עוסק ממתין' end
      else 'שם הספק'
    end, ', '), 500)
  from jsonb_array_elements(k.reasons) r;
$$;

-- An editor, unit manager or admin decides. Accepting submits the kind change: green is
-- saved, yellow waits for an admin, red is refused with its reason.
create function public.decide_kind_suggestion(target uuid, accept boolean)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  k public.kind_suggestions;
  answer jsonb;
begin
  if not private.has_role(array['editor', 'unit_manager']) then
    raise exception 'Not authorized' using errcode = 'PT403';
  end if;
  select * into k from public.kind_suggestions where id = target for update;
  if not found or k.status <> 'pending' then
    raise exception 'Suggestion not found' using errcode = 'PT404';
  end if;
  if not accept then
    update public.kind_suggestions set status = 'rejected', decided_by = auth.uid(),
      decided_at = now() where id = k.id;
    return 'rejected';
  end if;
  if (select entity_kind from public.suppliers where id = k.supplier_id) <> 'unknown' then
    update public.kind_suggestions set status = 'outdated', decided_by = auth.uid(),
      decided_at = now() where id = k.id;
    return 'outdated';
  end if;
  answer := public.submit_supplier_change(jsonb_build_object('supplier_id', k.supplier_id,
    'kind', 'entity_kind', 'value', k.suggested_kind, 'reason', private.suggestion_reason(k)));
  update public.kind_suggestions set status = 'accepted',
    request_id = (answer ->> 'request_id')::uuid, decided_by = auth.uid(), decided_at = now()
  where id = k.id;
  return answer ->> 'status';
end;
$$;

revoke all on function private.registry_kind(jsonb), private.number_kind(text, text),
  private.suggested_kind(public.suppliers), private.suggestion_reason(public.kind_suggestions)
  from public, anon, authenticated;
revoke all on function public.suggest_supplier_kinds(),
  public.decide_kind_suggestion(uuid, boolean) from public, anon;
grant execute on function public.suggest_supplier_kinds(),
  public.decide_kind_suggestion(uuid, boolean) to authenticated;
