-- The rest of the consolidated pool file: a hall row keeps the hall's details (capacity,
-- stage, sound) as the membership note, and the registries that were already on the
-- site get the phones, emails, addresses and numbers the file adds for their suppliers.

create or replace function private.pool_import_row(target jsonb, item jsonb, row_number integer)
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
    name_as_published, source_page, import_row_id, note, created_by)
  values (pick.supplier_id, (target ->> 'version')::uuid, field,
    left(item ->> 'published_name', 300), nullif(item ->> 'page', '')::integer, staged,
    nullif(left(item ->> 'note', 2000), ''), auth.uid())
  on conflict do nothing;
  update public.import_rows set status = 'promoted' where id = staged;
  perform private.pool_row_details(pick.supplier_id, item, (target ->> 'document')::uuid);
  return case when pick.created then 'created' else 'linked' end;
end
$$;

-- Takes the same file as import_pool_registry, for a registry already on the site.
-- Adds names, contacts and candidate numbers to the only active supplier with one of
-- each row's names; creates nothing else. Returns what matched and how many contacts
-- were added.
create function public.import_pool_contacts(file jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item jsonb;
  found uuid[];
  counts jsonb := '{"matched": 0, "unmatched": 0, "ambiguous": 0, "contacts": 0}';
  outcome text;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  for item in select jsonb_array_elements(file -> 'rows') loop
    select array_agg(s.id) into found from public.suppliers s
    where s.status = 'active' and exists (
      select 1 from jsonb_array_elements_text(item -> 'names') n
      where private.normalize_name(n) = s.normalized_name or exists (
        select 1 from public.supplier_names sn
        where sn.supplier_id = s.id and sn.normalized_name = private.normalize_name(n)));
    outcome := case coalesce(cardinality(found), 0)
      when 0 then 'unmatched' when 1 then 'matched' else 'ambiguous' end;
    if outcome = 'matched' then
      counts := jsonb_set(counts, '{contacts}', to_jsonb((counts ->> 'contacts')::integer
        + private.pool_row_details(found[1], item, null)));
    end if;
    counts := jsonb_set(counts, array[outcome], to_jsonb((counts ->> outcome)::integer + 1));
  end loop;
  return counts;
end
$$;

revoke all on function private.pool_import_row(jsonb, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.import_pool_contacts(jsonb) from public, anon, authenticated;
grant execute on function public.import_pool_contacts(jsonb) to authenticated;
