-- Loads a registry that the consolidated pool file lists but the site does not have
-- yet: the registry, its source document and version, its fields, and one membership
-- per row. Every membership, new supplier and identifier stays in review, exactly as
-- for any other import. A supplier is reused only when the file links the row to the
-- same consolidated supplier as an earlier row, or when exactly one active supplier
-- has one of its names. A row whose names fit more than one supplier stays pending
-- in import_rows for a person to decide.

-- The supplier for one file row: (1) the one an earlier row with the same file key
-- was linked to, (2) the only active supplier with one of the names, (3) a new one.
-- Returns null when the names fit more than one supplier.
create function private.pool_row_supplier(item jsonb, out supplier_id uuid, out created boolean)
language plpgsql
volatile
set search_path = ''
as $$
declare
  names text[] := array(
    select distinct private.normalize_name(n) from jsonb_array_elements_text(item -> 'names') n
    where private.normalize_name(n) is not null);
  found uuid[];
begin
  created := false;
  if item ->> 'key' like 'SUP-%' then
    select array_agg(distinct coalesce(s.merged_into_id, s.id)) into found
    from public.import_rows r
    join public.import_batches b on b.id = r.batch_id and b.script_name = 'pool_file'
    join public.memberships m on m.import_row_id = r.id
    join public.suppliers s on s.id = m.supplier_id
    where r.raw ->> 'key' = item ->> 'key';
  end if;
  if coalesce(cardinality(found), 0) = 0 then
    select array_agg(s.id) into found from public.suppliers s
    where s.status = 'active' and (s.normalized_name = any (names) or exists (
      select 1 from public.supplier_names n
      where n.supplier_id = s.id and n.normalized_name = any (names)));
  end if;
  if cardinality(found) > 1 then
    return;
  elsif cardinality(found) = 1 then
    supplier_id := found[1];
    return;
  end if;
  insert into public.suppliers (display_name, entity_kind, created_by)
  values (left(item ->> 'name', 300),
    case item ->> 'scheme' when 'company' then 'company' when 'nonprofit' then 'nonprofit'
      else 'unknown' end,
    auth.uid())
  returning id into supplier_id;
  created := true;
end
$$;

-- Adds what the row knows about the supplier and the supplier does not have yet:
-- names as published, contacts, and the file's number as a pending candidate.
-- Returns how many contacts it added.
create function private.pool_row_details(supplier uuid, item jsonb, document uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  added integer;
begin
  insert into public.supplier_names (supplier_id, name, kind, source_document_id, created_by)
  select supplier, left(n, 300), 'as_published', document, auth.uid()
  from jsonb_array_elements_text(item -> 'names') n
  where private.normalize_name(n) is not null
  on conflict do nothing;
  with given (kind, value) as (
    select 'phone', p from jsonb_array_elements_text(item -> 'phones') p
    union select 'email', e from jsonb_array_elements_text(item -> 'emails') e
    union select 'address', item ->> 'address'
    union select 'contact_person', item ->> 'person'
  ),
  inserted as (
    insert into public.supplier_contacts (supplier_id, kind, value, source_document_id,
      created_by)
    select distinct supplier, g.kind, left(trim(g.value), 500), document, auth.uid()
    from given g
    where length(trim(coalesce(g.value, ''))) > 0 and not exists (
      select 1 from public.supplier_contacts c
      where c.supplier_id = supplier and c.kind = g.kind and c.normalized_value = case g.kind
        when 'email' then lower(trim(g.value))
        when 'phone' then regexp_replace(g.value, '[^0-9+]', '', 'g')
        else trim(g.value) end)
    returning 1
  )
  select count(*) into added from inserted;
  if item ->> 'value' is not null and not exists (
    select 1 from public.supplier_identifiers i
    where i.supplier_id = supplier and i.scheme = item ->> 'scheme'
      and i.value = item ->> 'value' and i.review_status <> 'rejected'
  ) then
    insert into public.identifier_candidates (supplier_id, scheme, value, source,
      searched_name, found_by)
    values (supplier, item ->> 'scheme', item ->> 'value', 'pool_file',
      left(item ->> 'name', 300), auth.uid())
    on conflict (supplier_id, scheme, value) do nothing;
  end if;
  return added;
end
$$;

-- Creates the registry, its source document, version and import batch.
create function private.pool_registry_batch(file jsonb, out registry uuid, out version uuid,
  out document uuid, out batch uuid)
language plpgsql
volatile
set search_path = ''
as $$
begin
  insert into public.registries (name, status, note, created_by)
  values (file ->> 'name', coalesce(file ->> 'status', 'unknown'), left(file ->> 'note', 2000),
    auth.uid())
  returning id into registry;
  insert into public.source_documents (url, file_name, note, created_by)
  values (file ->> 'url', left(file ->> 'file_name', 300),
    'מקור לפי קובץ המאגר המאוחד', auth.uid())
  returning id into document;
  insert into public.registry_versions (registry_id, source_document_id, created_by)
  values (registry, document, auth.uid())
  returning id into version;
  insert into public.import_batches (source_document_id, registry_id, registry_version_id,
    script_name, script_version, row_count, status, note, created_by)
  values (document, registry, version, 'pool_file', 'pool_file_registries.py',
    jsonb_array_length(file -> 'rows'), 'in_review', 'קובץ מאגר מאוחד', auth.uid())
  returning id into batch;
end
$$;

-- One row: staged in import_rows, then promoted to a membership unless ambiguous.
create function private.pool_import_row(target jsonb, item jsonb, row_number integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  staged bigint;
  pick record;
  field uuid;
begin
  insert into public.import_rows (batch_id, row_number, source_page, raw, created_by)
  values ((target ->> 'batch')::uuid, row_number, nullif(item ->> 'page', '')::integer, item,
    auth.uid())
  returning id into staged;
  pick := private.pool_row_supplier(item);
  if pick.supplier_id is null then
    update public.import_rows set reviewer_note = 'השם מתאים ליותר מספק אחד; יש לבחור ידנית'
    where id = staged;
    return 'ambiguous';
  end if;
  if length(trim(coalesce(item ->> 'field', ''))) > 0 then
    insert into public.registry_fields (registry_id, source_text, created_by)
    values ((target ->> 'registry')::uuid, left(trim(item ->> 'field'), 500), auth.uid())
    on conflict do nothing;
    select f.id into field from public.registry_fields f
    where f.registry_id = (target ->> 'registry')::uuid
      and lower(trim(f.source_text)) = lower(left(trim(item ->> 'field'), 500));
  end if;
  insert into public.memberships (supplier_id, registry_version_id, registry_field_id,
    name_as_published, source_page, import_row_id, created_by)
  values (pick.supplier_id, (target ->> 'version')::uuid, field,
    left(item ->> 'published_name', 300),
    nullif(item ->> 'page', '')::integer, staged, auth.uid())
  on conflict do nothing;
  update public.import_rows set status = 'promoted' where id = staged;
  perform private.pool_row_details(pick.supplier_id, item, (target ->> 'document')::uuid);
  return case when pick.created then 'created' else 'linked' end;
end
$$;

-- Takes { "name", "status", "note", "url", "file_name", "rows": [...] } for one registry that
-- does not exist yet. Each row: key, name, names[], published_name, field, page,
-- phones[], emails[], address, person, scheme, value. Returns a count per outcome.
create function public.import_pool_registry(file jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  made record;
  target jsonb;
  outcome text;
  counts jsonb := '{"created": 0, "linked": 0, "ambiguous": 0}';
  item jsonb;
  ord bigint;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.registries r
    where lower(trim(r.name)) = lower(trim(file ->> 'name'))) then
    raise exception 'Registry % already exists', file ->> 'name' using errcode = '23505';
  end if;
  made := private.pool_registry_batch(file);
  target := jsonb_build_object('registry', made.registry, 'version', made.version,
    'document', made.document, 'batch', made.batch);
  for item, ord in select e.item, e.ord
    from jsonb_array_elements(file -> 'rows') with ordinality as e(item, ord) loop
    outcome := private.pool_import_row(target, item, ord::integer);
    counts := jsonb_set(counts, array[outcome], to_jsonb((counts ->> outcome)::integer + 1));
  end loop;
  return counts || jsonb_build_object('registry_id', made.registry,
    'memberships', (select count(*) from public.memberships m
      where m.registry_version_id = made.version),
    'fields', (select count(*) from public.registry_fields f
      where f.registry_id = made.registry));
end
$$;

revoke all on function private.pool_row_supplier(jsonb) from public, anon, authenticated;
revoke all on function private.pool_row_details(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function private.pool_registry_batch(jsonb) from public, anon, authenticated;
revoke all on function private.pool_import_row(jsonb, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.import_pool_registry(jsonb) from public, anon, authenticated;
grant execute on function public.import_pool_registry(jsonb) to authenticated;
