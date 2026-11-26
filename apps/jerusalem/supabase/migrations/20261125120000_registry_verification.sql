-- Stage B of the alignment review (25.11): verify a registry against its document.
-- A reviewer (an admin, or the manager of the unit that owns the registry) sets the
-- registry's "valid until" from the call for proposals and decides each supplier on its own.
-- The verification trigger still decides who may verify a row and records who did and when.

create or replace function private.reviews_registry(registry uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or exists (
    select 1 from public.registries r
    where r.id = registry and private.manages_unit(r.owner_unit_id))
$$;
revoke all on function private.reviews_registry(uuid) from public, anon;
grant execute on function private.reviews_registry(uuid) to authenticated;

-- The version a registry is reviewed by: the newest one by its start date.
create or replace function private.current_version(registry uuid)
returns uuid language sql stable set search_path = '' as $$
  select v.id from public.registry_versions v where v.registry_id = registry
  order by v.valid_from desc nulls last, v.created_at desc limit 1
$$;
revoke all on function private.current_version(uuid) from public, anon, authenticated;

create or replace function private.version_counts(version uuid, today date)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'needs_review', count(*) filter (where m.review_status = 'needs_review'),
    'verified', count(*) filter (where m.review_status = 'verified'),
    'rejected', count(*) filter (where m.review_status = 'rejected'),
    'expired', count(*) filter (where m.review_status <> 'rejected'
      and coalesce(m.registered_until, v.valid_until) < today))
  from public.memberships m join public.registry_versions v on v.id = m.registry_version_id
  where m.registry_version_id = version and m.review_status <> 'removed'
$$;
revoke all on function private.version_counts(uuid, date) from public, anon, authenticated;

-- Every registry this user may review, with its current version and where it stands.
create or replace function public.registry_reviews()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := private.israel_today();
begin
  if not (private.is_admin() or private.has_role(array['unit_manager'])) then
    raise exception 'Only an admin or a unit manager reviews registries' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('registry_id', r.id, 'name', r.name,
      'unit', u.name, 'version_id', v.id, 'document', d.url, 'valid_from', v.valid_from,
      'valid_until', v.valid_until, 'counts', private.version_counts(v.id, today))
      order by r.name)
    from public.registries r
    join public.registry_versions v on v.id = private.current_version(r.id)
    left join public.org_units u on u.id = r.owner_unit_id
    left join public.source_documents d on d.id = v.source_document_id
    where r.status = 'active' and private.reviews_registry(r.id)), '[]'::jsonb);
end
$$;
revoke all on function public.registry_reviews() from public, anon;
grant execute on function public.registry_reviews() to authenticated;

-- One version and its suppliers, in the order of the document.
create or replace function public.registry_review(version uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  registry uuid;
begin
  select v.registry_id into registry from public.registry_versions v where v.id = version;
  if registry is null or not private.reviews_registry(registry) then
    raise exception 'Not permitted to review this registry' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('registry_id', r.id, 'name', r.name, 'version_id', v.id,
      'document', d.url, 'valid_from', v.valid_from, 'valid_until', v.valid_until,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('id', m.id, 'supplier_id', s.id,
          'supplier', s.display_name, 'name_as_published', m.name_as_published,
          'field', f.source_text, 'source_page', m.source_page,
          'registered_until', m.registered_until, 'review_status', m.review_status,
          'note', m.note)
          order by m.source_page nulls last, coalesce(m.name_as_published, s.display_name))
        from public.memberships m
        join public.suppliers s on s.id = m.supplier_id
        left join public.registry_fields f on f.id = m.registry_field_id
        where m.registry_version_id = v.id and m.review_status <> 'removed'), '[]'::jsonb))
    from public.registry_versions v
    join public.registries r on r.id = v.registry_id
    left join public.source_documents d on d.id = v.source_document_id
    where v.id = version);
end
$$;
revoke all on function public.registry_review(uuid) from public, anon;
grant execute on function public.registry_review(uuid) to authenticated;

-- "בתוקף עד" from the call for proposals. Null clears it. Members without their own date
-- inherit it (see private.lapsed_registrations and the catalog).
create or replace function public.set_registry_validity(version uuid, valid_until date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  registry uuid;
  starts date;
begin
  select v.registry_id, v.valid_from into registry, starts
  from public.registry_versions v where v.id = version for update;
  if registry is null or not private.reviews_registry(registry) then
    raise exception 'Not permitted to review this registry' using errcode = '42501';
  end if;
  if valid_until is not null and starts is not null and valid_until < starts then
    raise exception 'Valid until is before the registry started' using errcode = '22023';
  end if;
  update public.registry_versions v set valid_until = set_registry_validity.valid_until,
    updated_at = now()
  where v.id = version;
end
$$;
revoke all on function public.set_registry_validity(uuid, date) from public, anon;
grant execute on function public.set_registry_validity(uuid, date) to authenticated;

-- One supplier in the registry: verified against the document, or rejected with a reason
-- (Menash, 25.11: each supplier on its own, no whole-registry step). Runs with the caller's
-- rights, so the table policies and the verification trigger apply.
create or replace function public.decide_membership(membership uuid, approve boolean,
  note text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  reason text := nullif(trim(coalesce(note, '')), '');
begin
  if approve is null or (not approve and (reason is null or length(reason) not between 2 and 500))
    or length(coalesce(reason, '')) > 500 then
    raise exception 'A rejection needs a reason' using errcode = '22023';
  end if;
  if not private.reviews_registry((select v.registry_id from public.memberships m
      join public.registry_versions v on v.id = m.registry_version_id where m.id = membership)) then
    raise exception 'Not permitted to review this registry' using errcode = '42501';
  end if;
  update public.memberships m
  set review_status = case when approve then 'verified' else 'rejected' end,
    note = coalesce(reason, m.note)
  where m.id = membership and m.review_status <> 'removed';
end
$$;
revoke all on function public.decide_membership(uuid, boolean, text) from public, anon;
grant execute on function public.decide_membership(uuid, boolean, text) to authenticated;

-- While there is a single admin, that admin may verify a membership they loaded themselves
-- (Menash, 25.11). The rows come from the municipality's published document, not from the
-- admin. Once a second active admin exists the usual rule returns by itself. Other tables
-- keep the rule as it is.
create or replace function private.sole_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() and (
    select count(distinct g.user_id) from public.role_grants g
    join public.profiles p on p.user_id = g.user_id and p.status = 'active'
    where g.role = 'admin' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())) = 1
$$;
revoke all on function private.sole_admin() from public, anon;
grant execute on function private.sole_admin() to authenticated;

create or replace function private.guard_verification()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.review_status = 'verified'
    and (tg_op = 'INSERT' or old.review_status is distinct from 'verified') then
    if auth.uid() is not null and not private.has_role(array['unit_manager']) then
      raise exception 'Only a unit manager or an admin can verify' using errcode = '42501';
    end if;
    if auth.uid() is not null and auth.uid() = new.created_by
      and not (tg_table_name = 'memberships' and private.sole_admin()) then
      raise exception 'reason:self_verification' using errcode = '42501';
    end if;
    new.verified_by := coalesce(auth.uid(), new.verified_by);
    new.verified_at := now();
  elsif new.review_status <> 'verified' then
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;
