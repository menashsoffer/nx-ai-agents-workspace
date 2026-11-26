-- Supplier import from Excel (spec documentation/supplier-excel-import-spec-he.md, section 10).
-- Built by Codex on 17.11.2026 (branch codex/supplier-import-db), ported onto main 22.11.2026.
-- Excel imports reuse the existing staging tables. Uploaded content is private.
alter table public.import_rows
  add column decision text check (decision in ('new', 'link', 'hold')),
  add column target_supplier_id uuid references public.suppliers (id) on delete restrict,
  add column edited jsonb check (
    edited is null or (jsonb_typeof(edited) = 'object' and octet_length(edited::text) <= 20000)
  ),
  add column error text check (length(error) <= 500),
  add column decided_by uuid references auth.users (id) on delete set null,
  add column decided_at timestamptz,
  add constraint import_rows_excel_decision_target_check
    check ((decision = 'link' and target_supplier_id is not null)
      or (decision = 'new' and status = 'promoted' and target_supplier_id is not null)
      or (decision is distinct from 'link' and target_supplier_id is null));
create index import_rows_target_supplier_idx on public.import_rows (target_supplier_id);
create index import_rows_decided_by_idx on public.import_rows (decided_by);

-- Auditor access to the audit log must not reveal spreadsheet contents.
drop trigger audit_row on public.import_rows;
create trigger audit_row after insert or update or delete on public.import_rows
  for each row execute function private.audit_row('raw', 'edited', 'error', 'reviewer_note');

alter table public.source_documents alter column url drop not null;
alter table public.source_documents add column storage_path text
  check (length(storage_path) between 1 and 500);
alter table public.source_documents add constraint source_documents_location_check
  check (url is not null or (content_sha256 is not null and storage_path is not null));
drop policy source_documents_read on public.source_documents;
create policy source_documents_read on public.source_documents for select to authenticated
  using ((select private.is_member()) and (storage_path is null or (select private.is_admin())));

drop trigger audit_row on public.source_documents;
create trigger audit_row after insert or update or delete on public.source_documents
  for each row execute function private.audit_row('url', 'file_name', 'storage_path', 'note');

alter table public.identifier_candidates drop constraint identifier_candidates_source_check;
alter table public.identifier_candidates add constraint identifier_candidates_source_check
  check (source in ('companies_registrar', 'nonprofits_registrar', 'guidestar', 'pool_file',
    'excel_import'));
alter table public.supplier_identifiers drop constraint supplier_identifiers_source_check;
alter table public.supplier_identifiers add constraint supplier_identifiers_source_check
  check (source in ('companies_registrar', 'nonprofits_registrar', 'guidestar',
    'municipality', 'manual', 'pool_file', 'excel_import'));

-- Only the two file types the import reads; the site sends each with its own type.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('source-files', 'source-files', false, 5242880, array['text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy source_files_select on storage.objects for select to authenticated
  using (bucket_id = 'source-files' and (select private.is_admin()));
create policy source_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'source-files' and (select private.is_admin()));
create policy source_files_update on storage.objects for update to authenticated
  using (bucket_id = 'source-files' and (select private.is_admin()) and not exists (
    select 1 from public.source_documents d where d.storage_path = name))
  with check (bucket_id = 'source-files' and (select private.is_admin()) and not exists (
    select 1 from public.source_documents d where d.storage_path = name));
create policy source_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'source-files' and (select private.is_admin()) and not exists (
    select 1 from public.source_documents d where d.storage_path = name));

-- The protection layer (excel-import-errors-spec-he.md, section 3), the same rules the browser
-- checks first: no control or direction-override characters, nothing a spreadsheet would run
-- as a formula when the data is exported, no markup or script address, and a length limit.
create function private.excel_unsafe(value text)
returns boolean language sql immutable set search_path = '' as $$
  select value is not null and (
    length(value) > 2000
    or value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]'
    or value ~ '^[=@\t\r]' or value ~ '^[+-][^0-9\s(]'
    or value ~* '<\s*[a-z!/?]' or value ~* '\m(javascript|vbscript|data)\s*:');
$$;
revoke all on function private.excel_unsafe(text) from public, anon, authenticated;

-- Mapped values: only the known fields, each a string or null, each safe.
create function private.excel_edited_ok(edited jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(edited) = 'object' and not exists (
    select 1 from jsonb_each(edited) e
    where e.key not in ('name', 'entity_kind', 'scheme', 'value', 'field', 'phone', 'email',
        'address', 'contact_person', 'website')
      or jsonb_typeof(e.value) not in ('string', 'null')
      or private.excel_unsafe(e.value #>> '{}'));
$$;
revoke all on function private.excel_edited_ok(jsonb) from public, anon, authenticated;

-- Recompute suggestions when an administrator returns to a saved draft.
create function private.excel_candidates(edited jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.display_name,
      'match_rank', c.match_rank) order by c.match_rank, c.display_name), '[]'::jsonb)
  from (
      select s.id, s.display_name, case
        when exists (select 1 from public.supplier_identifiers i where i.supplier_id = s.id
          and i.scheme = edited ->> 'scheme' and i.value = edited ->> 'value'
          and i.review_status = 'verified') then 1
        when exists (select 1 from public.supplier_identifiers i where i.supplier_id = s.id
          and i.scheme = edited ->> 'scheme' and i.value = edited ->> 'value'
          and i.review_status = 'needs_review') or exists (
          select 1 from public.identifier_candidates i where i.supplier_id = s.id
            and i.scheme = edited ->> 'scheme'
            and i.value = edited ->> 'value' and i.status = 'pending') then 2
        when s.normalized_name = private.normalize_name(edited ->> 'name') or exists (
          select 1 from public.supplier_names n where n.supplier_id = s.id
            and n.normalized_name = private.normalize_name(edited ->> 'name')) then 3
        else 4 end as match_rank
      from public.suppliers s where s.status = 'active' and (
        exists (select 1 from public.supplier_identifiers i where i.supplier_id = s.id
          and i.scheme = edited ->> 'scheme' and i.value = edited ->> 'value'
          and i.review_status <> 'rejected')
        or exists (select 1 from public.identifier_candidates i where i.supplier_id = s.id
          and i.scheme = edited ->> 'scheme' and i.value = edited ->> 'value'
          and i.status = 'pending')
        or s.normalized_name = private.normalize_name(edited ->> 'name')
        or exists (select 1 from public.supplier_names n where n.supplier_id = s.id
          and n.normalized_name = private.normalize_name(edited ->> 'name'))
        or extensions.similarity(s.normalized_name,
          private.normalize_name(edited ->> 'name')) >= 0.6)
      order by match_rank, s.display_name limit 20
    ) c;
$$;
revoke all on function private.excel_candidates(jsonb) from public, anon, authenticated;

-- Stage immutable source rows; mapped values are a separate editable object.
create function public.stage_excel_import(batch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  document_id uuid;
  batch_id uuid;
  registry uuid := nullif(batch ->> 'registry_id', '')::uuid;
  version uuid := nullif(batch ->> 'registry_version_id', '')::uuid;
  item jsonb;
  row_id bigint;
  candidates jsonb;
  staged jsonb := '[]'::jsonb;
  digest text := batch ->> 'content_sha256';
  path text := batch ->> 'storage_path';
  new_version boolean := false;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(batch) <> 'object' then
    raise exception 'reason:import_batch_invalid' using errcode = '22023';
  end if;
  if batch ? 'batch_id' then
    batch_id := (batch ->> 'batch_id')::uuid;
    if not exists (select 1 from public.import_batches b where b.id = batch_id
      and b.script_name = 'excel_import') then
      raise exception 'reason:import_batch_missing' using errcode = 'P0002';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('row_id', r.id,
      'candidates', private.excel_candidates(r.edited)) order by r.row_number), '[]'::jsonb)
    into staged from public.import_rows r where r.batch_id = (batch ->> 'batch_id')::uuid
      and r.status = 'pending';
    return jsonb_build_object('batch_id', batch_id, 'duplicate', true, 'rows', staged);
  end if;
  if coalesce(jsonb_typeof(batch -> 'rows'), '') <> 'array'
    or jsonb_array_length(batch -> 'rows') not between 1 and 5000
    or octet_length((batch -> 'rows')::text) > 15728640
    or digest is null or digest !~ '^[0-9a-f]{64}$'
    or path is null or length(path) not between 1 and 500
    or length(coalesce(batch ->> 'file_name', '')) not between 1 and 300
    or lower(batch ->> 'file_name') !~ '[.](xlsx|csv)$'
    or private.excel_unsafe(batch ->> 'file_name')
    or path <> 'excel/' || digest || '.'
      || substring(lower(batch ->> 'file_name') from '(xlsx|csv)$')
  then
    raise exception 'reason:import_batch_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'source-files'
      and o.name = path and (o.metadata ->> 'size')::bigint between 1 and 5242880) then
    raise exception 'reason:import_file_missing' using errcode = '22023';
  end if;
  select b.id into batch_id from public.source_documents d
    join public.import_batches b on b.source_document_id = d.id
    where d.content_sha256 = digest and b.script_name = 'excel_import' limit 1;
  if batch_id is not null then
    return jsonb_build_object('batch_id', batch_id, 'duplicate', true);
  end if;
  select id into document_id from public.source_documents where content_sha256 = digest;
  if document_id is not null then
    return jsonb_build_object('batch_id', null, 'source_document_id', document_id,
      'duplicate', true);
  end if;
  if registry is null and nullif(trim(batch ->> 'registry_name'), '') is not null then
    insert into public.registries (name, status) values (trim(batch ->> 'registry_name'), 'unknown')
      returning id into registry;
  end if;
  if registry is not null and version is null then
    insert into public.registry_versions (registry_id) values (registry) returning id into version;
    new_version := true;
  end if;
  if (registry is null) <> (version is null) or (version is not null and not exists (
    select 1 from public.registry_versions v where v.id = version and v.registry_id = registry
  )) then
    raise exception 'reason:import_registry_invalid' using errcode = '22023';
  end if;
  insert into public.source_documents (url, file_name, content_sha256, storage_path, published_on)
  values (nullif(batch ->> 'url', ''), batch ->> 'file_name', digest, path,
    nullif(batch ->> 'published_on', '')::date) returning id into document_id;
  if new_version then
    update public.registry_versions set source_document_id = document_id where id = version;
  end if;
  insert into public.import_batches (source_document_id, registry_id, registry_version_id,
    script_name, row_count) values (document_id, registry, version, 'excel_import',
    jsonb_array_length(batch -> 'rows')) returning id into batch_id;
  for item in select * from jsonb_array_elements(batch -> 'rows') loop
    if jsonb_typeof(item -> 'raw') <> 'object' or not private.excel_edited_ok(item -> 'edited')
      or (select count(*) from jsonb_object_keys(item -> 'raw')) > 200
      or (item ->> 'row_number') !~ '^[1-9][0-9]{0,7}$' then
      raise exception 'reason:import_row_invalid' using errcode = '22023';
    end if;
    insert into public.import_rows (batch_id, row_number, raw, edited, decision)
    values (batch_id, (item ->> 'row_number')::integer, item -> 'raw', item -> 'edited', 'hold')
    returning id into row_id;
    candidates := private.excel_candidates(item -> 'edited');
    staged := staged || jsonb_build_array(jsonb_build_object('row_id', row_id,
      'candidates', candidates));
  end loop;
  return jsonb_build_object('batch_id', batch_id, 'duplicate', false, 'rows', staged);
end;
$$;
revoke all on function public.stage_excel_import(jsonb) from public, anon, authenticated;
grant execute on function public.stage_excel_import(jsonb) to authenticated;

-- Decisions are explicit; staging a candidate never links it to a supplier.
create function public.decide_import_rows(decisions jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  changed integer := 0;
  target uuid;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(decisions) <> 'array' or jsonb_array_length(decisions) > 5000 then
    raise exception 'reason:import_decision_invalid' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(decisions) loop
    target := nullif(item ->> 'target_supplier_id', '')::uuid;
    if item ->> 'decision' is null or item ->> 'decision' not in ('new', 'link', 'hold', 'skip')
      or not private.excel_edited_ok(item -> 'edited')
      or ((item ->> 'decision' = 'link') <> (target is not null))
      or (target is not null and not exists (select 1 from public.suppliers
        where id = target and status = 'active'))
      or (item ->> 'decision' = 'skip' and length(trim(coalesce(item ->> 'note', ''))) < 2) then
      raise exception 'reason:import_decision_invalid' using errcode = '22023';
    end if;
    update public.import_rows r set
      decision = case when item ->> 'decision' = 'skip' then 'hold' else item ->> 'decision' end,
      target_supplier_id = target, edited = item -> 'edited', error = null,
      status = case when item ->> 'decision' = 'skip' then 'rejected' else 'pending' end,
      reviewer_note = case when item ->> 'decision' = 'skip' then item ->> 'note' else null end,
      decided_by = auth.uid(), decided_at = now()
    from public.import_batches b where r.id = (item ->> 'row_id')::bigint
      and r.batch_id = b.id and b.script_name = 'excel_import' and r.status = 'pending';
    if not found then
      raise exception 'reason:already_decided' using errcode = '22023';
    end if;
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;
revoke all on function public.decide_import_rows(jsonb) from public, anon, authenticated;
grant execute on function public.decide_import_rows(jsonb) to authenticated;

-- Each row uses an exception subtransaction, so a bad row does not undo others.
create function private.apply_excel_row(row_id bigint)
returns void language plpgsql set search_path = '' as $$
declare
  r public.import_rows;
  b public.import_batches;
  v jsonb;
  supplier uuid;
  field_id uuid;
  kind text;
  value text;
begin
  select * into strict r from public.import_rows where id = row_id for update;
  select * into strict b from public.import_batches where id = r.batch_id;
  v := r.edited;
  if not private.excel_edited_ok(v) then raise exception 'reason:import_unsafe_value'; end if;
  if length(trim(coalesce(v ->> 'name', ''))) not between 1 and 300 then
    raise exception 'reason:import_name_invalid';
  end if;
  if coalesce(nullif(v ->> 'entity_kind', ''), 'unknown') not in
    ('company', 'sole_trader', 'nonprofit', 'partnership', 'cooperative', 'public_body',
      'unknown')
    or (nullif(v ->> 'website', '') is not null and v ->> 'website' !~ '^https?://')
    or (nullif(v ->> 'value', '') is not null and (v ->> 'value' !~ '^[0-9]{5,9}$'
      or v ->> 'scheme' not in ('company', 'nonprofit', 'vat_dealer', 'personal_id'))) then
    raise exception 'reason:import_fields_invalid';
  end if;
  if r.decision = 'new' then
    insert into public.suppliers (display_name, entity_kind, website)
    values (trim(v ->> 'name'), coalesce(nullif(v ->> 'entity_kind', ''), 'unknown'),
      nullif(v ->> 'website', '')) returning id into supplier;
  elsif r.decision = 'link' then
    select id into strict supplier from public.suppliers
      where id = r.target_supplier_id and status = 'active' for update;
    update public.suppliers set
      entity_kind = case when entity_kind = 'unknown'
        then coalesce(nullif(v ->> 'entity_kind', ''), 'unknown') else entity_kind end,
      website = coalesce(website, nullif(v ->> 'website', '')) where id = supplier;
  else
    raise exception 'reason:import_decision_invalid';
  end if;
  if nullif(v ->> 'value', '') is not null and exists (
    select 1 from public.supplier_identifiers i where i.scheme = v ->> 'scheme'
      and i.value = v ->> 'value' and i.supplier_id <> supplier and i.review_status <> 'rejected'
  ) then
    raise exception 'reason:identifier_taken';
  end if;
  insert into public.supplier_names (supplier_id, name, kind, source_document_id)
    values (supplier, trim(v ->> 'name'), 'as_published', b.source_document_id)
    on conflict do nothing;
  for kind, value in select * from (values ('phone', v ->> 'phone'), ('email', v ->> 'email'),
    ('address', v ->> 'address'), ('contact_person', v ->> 'contact_person')) as x(k, val)
  loop
    if nullif(trim(value), '') is not null then
      if length(trim(value)) > 500 then raise exception 'reason:import_fields_invalid'; end if;
      insert into public.supplier_contacts (supplier_id, kind, value, source_document_id)
        values (supplier, kind, trim(value), b.source_document_id) on conflict do nothing;
    end if;
  end loop;
  if nullif(v ->> 'value', '') is not null and not exists (
    select 1 from public.supplier_identifiers i where i.supplier_id = supplier
      and i.scheme = v ->> 'scheme' and i.value = v ->> 'value' and i.review_status <> 'rejected'
  ) then
    insert into public.identifier_candidates (supplier_id, scheme, value, source, searched_name,
      found_by) values (supplier, v ->> 'scheme', v ->> 'value', 'excel_import',
      trim(v ->> 'name'), auth.uid()) on conflict do nothing;
  end if;
  if b.registry_version_id is not null then
    if nullif(trim(v ->> 'field'), '') is not null then
      insert into public.registry_fields (registry_id, source_text)
        values (b.registry_id, trim(v ->> 'field')) on conflict do nothing;
      select id into strict field_id from public.registry_fields where registry_id = b.registry_id
        and lower(trim(source_text)) = lower(trim(v ->> 'field'));
    end if;
    insert into public.memberships (supplier_id, registry_version_id, registry_field_id,
      name_as_published, import_row_id) values (supplier, b.registry_version_id, field_id,
      trim(v ->> 'name'), r.id) on conflict do nothing;
  end if;
  update public.import_rows set status = 'promoted', target_supplier_id = supplier, error = null
    where id = r.id;
end;
$$;
revoke all on function private.apply_excel_row(bigint) from public, anon, authenticated;

create function public.apply_import_batch(batch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  succeeded integer := 0;
  failed integer := 0;
  waiting integer;
begin
  if not private.is_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform 1 from public.import_batches where id = batch and script_name = 'excel_import' for update;
  if not found then
    raise exception 'reason:import_batch_missing' using errcode = 'P0002';
  end if;
  for r in select id from public.import_rows where batch_id = batch and status = 'pending'
    and decision in ('new', 'link') order by row_number for update
  loop
    begin
      perform private.apply_excel_row(r.id);
      succeeded := succeeded + 1;
    exception when others then
      -- A known refusal keeps its reason; anything else is stored as an unexpected failure
      -- with its SQL state, so the screen never shows raw database text.
      update public.import_rows set error = case when sqlerrm ~ '^reason:[a-z_]+$' then sqlerrm
        else 'reason:import_row_failed:' || sqlstate end where id = r.id;
      failed := failed + 1;
    end;
  end loop;
  select count(*) into waiting from public.import_rows
    where batch_id = batch and status = 'pending';
  update public.import_batches set status = case when waiting = 0 then 'done' else 'in_review' end
    where id = batch;
  return jsonb_build_object('promoted', succeeded, 'failed', failed, 'pending', waiting);
end;
$$;
revoke all on function public.apply_import_batch(uuid) from public, anon, authenticated;
grant execute on function public.apply_import_batch(uuid) to authenticated;
