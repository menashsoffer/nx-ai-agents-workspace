-- Consolidate the known extraction duplicate after category seeding. Refuse to
-- discard conflicting memberships or changed source records; a person must review them.
do $$
declare
  duplicate_id constant uuid := '3dfb2369-695b-47ed-9a52-d255a245bfa3';
  kept_id constant uuid := 'e744ea22-d6d2-4f2f-9ca6-1c77cf148f15';
begin
  if not exists (select 1 from public.registry_fields where id = duplicate_id) then return; end if;
  if not exists (
    select 1 from public.registry_fields d join public.registry_fields k on k.registry_id = d.registry_id
    where d.id = duplicate_id and k.id = kept_id
      and d.source_text = 'ניהול פרויקטים, אינסטלציה, תיאום תשתיות, כמאי, מהנדס דרכים, תנועה, כבישים וחניי ה'
      and k.source_text = 'ניהול פרויקטים, אינסטלציה, תיאום תשתיות, כמאי, מהנדס דרכים, תנועה, כבישים וחנייה'
      and d.source_code is not distinct from k.source_code
  ) then raise exception 'Road-field snapshot differs; review before cleanup'; end if;
  -- Only remove a collision when every stored attribute matches, other than
  -- row identity, the field being consolidated, page and import-row reference.
  -- A missing page cannot be recorded as evidence, so it requires review too.
  if exists (
    select 1 from public.memberships d join public.memberships k
      on k.supplier_id = d.supplier_id and k.registry_version_id = d.registry_version_id
    where d.registry_field_id = duplicate_id and k.registry_field_id = kept_id
      and (d.source_page is null or
        (to_jsonb(d) - array['id', 'registry_field_id', 'source_page', 'import_row_id'])
          is distinct from
        (to_jsonb(k) - array['id', 'registry_field_id', 'source_page', 'import_row_id']))
  ) then raise exception 'Conflicting memberships require manual review'; end if;
  update public.memberships k
  set note = concat_ws(' ', nullif(k.note, ''), 'מופיע גם בעמוד ' || d.source_page::text)
  from public.memberships d
  where d.registry_field_id = duplicate_id and k.registry_field_id = kept_id
    and k.supplier_id = d.supplier_id and k.registry_version_id = d.registry_version_id;
  -- A restrictive foreign key (e.g. an engagement request) prevents deletion;
  -- in that case the whole migration stops for manual review, with no data lost.
  delete from public.memberships d using public.memberships k
  where d.registry_field_id = duplicate_id and k.registry_field_id = kept_id
    and k.supplier_id = d.supplier_id and k.registry_version_id = d.registry_version_id;
  insert into public.registry_field_categories (registry_field_id, category_id, created_at, created_by)
    select kept_id, category_id, created_at, created_by from public.registry_field_categories
    where registry_field_id = duplicate_id on conflict (registry_field_id, category_id) do nothing;
  update public.memberships set registry_field_id = kept_id where registry_field_id = duplicate_id;
  update public.registry_fields set category_id = null where id = duplicate_id;
  delete from public.registry_field_categories where registry_field_id = duplicate_id;
  delete from public.registry_fields where id = duplicate_id;
end;
$$;
