-- Server side of the supplier-identifiers Edge Function. A lookup in the
-- Companies Registrar or GuideStar only finds candidates, because a similar name
-- is not proof of the same supplier. Candidates are stored by the function with
-- the service role, so their registrar details cannot be forged in the browser.
-- An editor accepts one, which adds it to supplier_identifiers as needs_review,
-- and a second person verifies it there as for any other identifier.

create table public.identifier_candidates (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  scheme text not null check (scheme in ('company', 'nonprofit')),
  value text not null check (value ~ '^[0-9]{5,9}$'),
  source text not null check (source in ('companies_registrar', 'guidestar')),
  registrar_name text check (length(registrar_name) <= 300),
  registrar_status text check (length(registrar_status) <= 100),
  searched_name text not null check (length(searched_name) between 1 and 300),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  found_at timestamptz not null default now(),
  found_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  identifier_id uuid references public.supplier_identifiers (id) on delete set null,
  unique (supplier_id, scheme, value)
);
create index identifier_candidates_found_by on public.identifier_candidates (found_by);
create index identifier_candidates_decided_by on public.identifier_candidates (decided_by);
create index identifier_candidates_identifier on public.identifier_candidates (identifier_id);

alter table public.identifier_candidates enable row level security;
revoke all on public.identifier_candidates from public, anon, authenticated;
grant select on public.identifier_candidates to authenticated;
create policy identifier_candidates_read on public.identifier_candidates for select
  to authenticated using ((select private.has_role(array['editor', 'unit_manager'])));

-- Authorizes the caller, counts the quota and returns the names to search for:
-- the display name and up to two other known names.
create function public.identifier_lookup_input(target uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.suppliers;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = 'PT401';
  end if;
  if not private.has_role(array['editor', 'unit_manager']) then
    raise exception 'Not authorized' using errcode = 'PT403';
  end if;
  select * into s from public.suppliers where id = target and status <> 'merged';
  if not found then
    raise exception 'Supplier not found' using errcode = 'PT404';
  end if;
  if not private.take_quota('supplier_identifiers', 30, interval '1 hour') then
    raise exception 'Too many lookups' using errcode = 'PT429';
  end if;
  return jsonb_build_object(
    'user_id', auth.uid(),
    'names', to_jsonb(array(
      select name from (
        select s.display_name as name, 0 as rank
        union
        select n.name, 1 from public.supplier_names n
        where n.supplier_id = s.id and n.normalized_name <> s.normalized_name
      ) names
      order by rank, name
      limit 3
    ))
  );
end
$$;

-- Stores what a lookup found and returns every pending candidate of the supplier.
-- A number the supplier already has is not stored again.
create function public.save_identifier_candidates(target uuid, finder uuid, found jsonb)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.identifier_candidates as c (supplier_id, scheme, value, source,
    registrar_name, registrar_status, searched_name, found_by)
  -- One row per number: the same number can come back for several names or from
  -- both sources, and an upsert may not touch a row twice. The registrar wins.
  select distinct on (f.scheme, f.value) target, f.scheme, f.value, f.source,
    left(f.registrar_name, 300), left(f.registrar_status, 100), left(f.searched_name, 300), finder
  from jsonb_to_recordset(found) as f(scheme text, value text, source text,
    registrar_name text, registrar_status text, searched_name text)
  where not exists (
    select 1 from public.supplier_identifiers i
    where i.supplier_id = target and i.scheme = f.scheme and i.value = f.value
      and i.review_status <> 'rejected'
  )
  order by f.scheme, f.value, f.source = 'guidestar'
  on conflict (supplier_id, scheme, value) do update
    set registrar_name = excluded.registrar_name, registrar_status = excluded.registrar_status,
      found_at = now(), found_by = excluded.found_by
    where c.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'scheme', c.scheme, 'value', c.value, 'source', c.source,
    'registrar_name', c.registrar_name, 'registrar_status', c.registrar_status,
    'searched_name', c.searched_name
  ) order by c.source, c.value), '[]'::jsonb)
  from public.identifier_candidates c
  where c.supplier_id = target and c.status = 'pending'
$$;

-- An editor accepts a candidate, which becomes an identifier that still needs
-- review, or dismisses it so later lookups do not offer it again.
create function public.decide_identifier_candidate(candidate uuid, accept boolean)
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
  if not private.has_role(array['editor', 'unit_manager']) then
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

revoke all on function public.identifier_lookup_input(uuid),
  public.save_identifier_candidates(uuid, uuid, jsonb),
  public.decide_identifier_candidate(uuid, boolean) from public, anon, authenticated;
grant execute on function public.identifier_lookup_input(uuid),
  public.decide_identifier_candidate(uuid, boolean) to authenticated;
grant execute on function public.save_identifier_candidates(uuid, uuid, jsonb) to service_role;
