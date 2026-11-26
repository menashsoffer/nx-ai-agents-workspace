-- The last 27 registry fields without a category (tiers ד and ה of
-- documentation/category-mapping/pool-file-proposed-mapping.csv), checked against the source
-- documents on the municipality site on 22.11.2026. See documentation/category-mapping/README.md.
--
-- 1. "אגף שיפור פני העיר": the field "יועץ" is an extraction error. A page heading such as
--    "יועץ / תכנון הסדרי תנועה" was split in two, so 32 memberships repeat a membership the same
--    supplier already has on the same page. Those repeats are deleted (the audit log keeps
--    them) and the empty field is removed. Pages 20 and 22 were read under the previous
--    page's heading: page 20 is "יועץ הידרו גיאולוגיה" and page 22 is "איטום / יועץ תכנון",
--    so those three memberships move to two new fields.
-- 2. The other 26 fields get categories. Rows are matched by id and current text, so the file
--    does nothing on staging and stops if a row was edited since.

do $$
declare
  registry constant uuid := '5b070406-1c75-4c34-a587-7c9631325a26';
  truncated constant uuid := '4a507601-3355-49a6-9096-8d86639ddad4';
  access_field constant uuid := '52ff9778-50a0-425a-b422-fb25fee83dce';
  surveys_field constant uuid := (
    select id from public.registry_fields
    where registry_id = registry and source_text = 'יועץ תסקירי תנועה');
  hydro constant uuid := '385cbaa7-9cf7-4777-a66e-35adabf1afa0';
  sealing constant uuid := '0f16743f-f1f6-480d-8796-31e6fc5c3ae9';
  removed integer;
begin
  if not exists (
    select 1 from public.registry_fields
    where id = truncated and registry_id = registry and source_text = 'יועץ'
  ) then return; end if;
  create temporary table truncated_repeat (membership_id uuid primary key, kept_field uuid)
    on commit drop;
  insert into truncated_repeat values
  ('07e19096-1c9c-4c7f-ae39-f83a39616c2d', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('13c3e0fd-56ba-4f8b-99ec-22b78e7cd0f8', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('17c77bde-542b-4925-a445-3dfa96c28956', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('191defdb-7a4e-4ef9-bcbc-5c40128900a5', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('51306921-86cc-4847-af92-6901f861e8be', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('6ef95944-c511-4a52-9f4b-f72621d38e75', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('7fbbd922-1c48-4e97-9f62-40a0ead3c1a4', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('9fb02a1d-2c13-4952-bcca-35f4a0b250ab', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('ac6f2d7e-893c-4353-adc5-247d0175556b', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('ae6b16db-96d3-45a2-a3de-d2ec7bd8e127', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('fc1e67b3-837e-4d5c-b924-58c347f15bb6', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('0639f36a-e6cc-485c-a5a5-11d5e7821e5f', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('3719d13f-4277-4bf4-9d46-0e21b76fd26d', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('4829d0e7-77fe-47d5-8678-035fe9faa210', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('6e064e55-a307-406d-9bf0-ce509893ff57', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('ad3dde26-dff3-4b78-b5cf-631fc330ee79', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('dfe916f3-23a4-443a-932b-87541980de89', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('e4f87b58-490e-4b26-8bc6-35daf82e72b3', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('e7f56aff-c65f-4c52-b965-75f7eb5bf3a0', '54633f0a-c216-4378-a3ff-bfef4f8d19df'),
  ('15d6a632-fa14-43f8-8a83-8a160b8eaf11', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('1ad12524-7ff9-420d-a592-c67aa4ecd745', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('277fe1be-ac80-4cfe-9140-bbcdf1204d54', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('4950021e-e1ac-4ad0-bcda-703ba91b4cdf', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('7d33b1f9-6c9a-467a-9ea5-93487a3db081', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('ac5257d4-7bfb-469a-aa96-15f29154ae53', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('c3fc523d-9232-440f-831d-3d94eec4142e', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('e1dd53c5-ad14-4807-9530-300f8e67eb04', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('f850149d-2072-4610-b50a-b3e3ad3a04ec', '53d67969-bf15-4fa1-b07d-40ea00700026'),
  ('255aed65-6732-4f97-958c-d4df38b32488', '52ff9778-50a0-425a-b422-fb25fee83dce'),
  ('a215631a-3bfa-44cd-aa26-1864dbebb50c', '52ff9778-50a0-425a-b422-fb25fee83dce'),
  ('b4d6ed65-7f33-4a5f-9a25-cfa8a5042e5c', '52ff9778-50a0-425a-b422-fb25fee83dce'),
  ('4a6918f2-ae5d-4aaf-ac79-6c4682eba29b', '52ff9778-50a0-425a-b422-fb25fee83dce');
  -- Each repeat must still sit on the truncated field next to the same supplier's kept row,
  -- and nothing (such as an engagement request) may point at it.
  if (select count(*) from truncated_repeat t
      join public.memberships d on d.id = t.membership_id and d.registry_field_id = truncated
      join public.memberships k on k.supplier_id = d.supplier_id
        and k.registry_version_id = d.registry_version_id and k.registry_field_id = t.kept_field
        and k.source_page = d.source_page
      where not exists (select 1 from public.engagement_requests e where e.membership_id = d.id)
     ) <> 32
    or (select count(*) from public.memberships where registry_field_id = truncated) <> 32
  then raise exception 'truncated-field snapshot differs; review "יועץ" by hand'; end if;
  if not exists (
    select 1 from public.memberships
    where id = 'e84b8966-5123-432e-8683-0b334338bcab' and registry_field_id = surveys_field
      and source_page = 22
  ) or (select count(*) from public.memberships where registry_field_id = access_field
        and source_page = 20 and id in ('35886f88-fc08-4546-9ebe-2d3b2ea89355',
          '9d93354e-0fc6-4cc3-a2f5-b9fe11c2c846')) <> 2
  then raise exception 'page 20/22 snapshot differs; review the moved memberships by hand'; end if;

  delete from public.memberships d using truncated_repeat t where d.id = t.membership_id;
  get diagnostics removed = row_count;
  if removed <> 32 then raise exception 'expected 32 repeats, removed %', removed; end if;
  delete from public.registry_field_categories where registry_field_id = truncated;
  delete from public.registry_fields where id = truncated;

  insert into public.registry_fields (id, registry_id, source_text) values
    (hydro, registry, 'יועץ הידרו גיאולוגיה'),
    (sealing, registry, 'יועץ תכנון איטום');
  update public.memberships
  set registry_field_id = hydro,
    note = concat_ws(' ', nullif(note, ''), 'תוקן 22.11.2026: עמוד 20 הוא יועץ הידרו גיאולוגיה')
  where id in ('35886f88-fc08-4546-9ebe-2d3b2ea89355', '9d93354e-0fc6-4cc3-a2f5-b9fe11c2c846');
  update public.memberships
  set registry_field_id = sealing,
    note = concat_ws(' ', nullif(note, ''), 'תוקן 22.11.2026: עמוד 22 הוא איטום / יועץ תכנון')
  where id = 'e84b8966-5123-432e-8683-0b334338bcab';
end;
$$;

create temporary table remaining_category_seed (
  field_id uuid not null, source_text text not null, root_name text not null, child_name text,
  unique (field_id, root_name, child_name)
) on commit drop;
insert into remaining_category_seed values
  ('f879f26a-3aec-4b63-8cb4-7f8b1fb2919a', 'א''1 מתח נמוך',
    'חירום וביטחון', null),
  ('b1948414-8dd5-43f7-877c-afba513dfa0d', 'א''1 מתח נמוך; א''2 מוכנות לחרום; ב''1 חרום מזרח העיר',
    'חירום וביטחון', null),
  ('1a1eb3a6-1454-45c3-8573-db3a5d2dce0c', 'א''1 מתח נמוך; ב''1 חרום מזרח העיר',
    'חירום וביטחון', null),
  ('f347de43-b20b-4c94-8755-ed1f749605e5', 'יועצי קרקע',
    'בנייה ומבנים', 'קרקע וביסוס'),
  ('3147752e-c038-4fca-8715-c84d98252e59', 'גיאוגרף/מתכנן ערים',
    'אדריכלות ועיצוב', 'תכנון ערים ופרוגרמות'),
  ('7cced3d6-607f-4ffd-b95c-41bf9e7c2a65', 'פרוגרמטור',
    'אדריכלות ועיצוב', 'תכנון ערים ופרוגרמות'),
  ('9db6d051-c6be-47ea-82b6-0e3d8e4d990d', 'יועצי אחזקה',
    'בנייה ומבנים', 'מערכות מבנה'),
  ('f09d0462-797f-4222-b3fe-1d17ab677060', 'אחראית מכרזים',
    'חינוך והשכלה', null),
  ('c0f3511f-8f9c-4fb3-aecf-da82fdf4aec0', 'דיקאנית',
    'חינוך והשכלה', null),
  ('8a1b4539-2094-47a2-831b-00c00953ac28', 'חשבת',
    'חינוך והשכלה', null),
  ('2f64127b-f74a-4be1-9c77-4560ab9f70f8', 'מזכירות אקדמית',
    'חינוך והשכלה', null),
  ('2b5914ec-653c-472a-9187-6e230c8c4971', 'מנהלת אוניברסיטה לנוער',
    'חינוך והשכלה', null),
  ('cde4837e-eab8-466f-80ce-23f042160c47', 'מנכ"ל )משותף( ומנהל מש"א',
    'חינוך והשכלה', null),
  ('cf9c55f3-6496-4892-a90b-4cc3254c0669', 'נוער שוחר מדע',
    'חינוך והשכלה', null),
  ('603c5ad7-7781-467c-9731-a99dad5845af', 'נוער שוחר מדע- נציגת האוניברסיטה',
    'חינוך והשכלה', null),
  ('168e85c8-1e07-495e-8253-be1f58ea68d0', 'סגן נשיא לענייני כספים ומינהל',
    'חינוך והשכלה', null),
  ('86a0f2ca-74d5-41c2-90d8-e7ab959374b0', 'סגנית נשיא',
    'חינוך והשכלה', null),
  ('17d1cc69-58e2-4083-a13e-f9635b36f3f8', 'סמנכ״ל',
    'חינוך והשכלה', null),
  ('333aa83a-9bba-4ef2-b5ae-bacd64544ef2', 'סמנכ"ל לפיתוח מוסדי וקשרים רגולטורים',
    'חינוך והשכלה', null),
  ('4e491ab7-e612-4222-b0cd-e37c4666bc1d', 'ראש אקדמי קמפוס טל_לב',
    'חינוך והשכלה', null),
  ('5c141e52-1db1-4a0e-8bcc-d8ad27151681', 'ראש המחלקה לחינוך',
    'חינוך והשכלה', null),
  ('8018b122-e4d7-4421-8b09-868f9e2c9934', 'ראש המכון ללימודי חוץ',
    'חינוך והשכלה', null),
  ('8046e9b0-39c2-47b7-b56d-5687acdd9bcb', 'ראש המכללה',
    'חינוך והשכלה', null),
  ('19c2e478-5e9b-4b75-bbd3-939149e709f4', 'ראש המנהל האקדמי',
    'חינוך והשכלה', null),
  ('923c3dfb-7d8b-45c7-9f9c-8771b8a0ba82', 'ראש תחום אקדמיה- שדה',
    'חינוך והשכלה', null),
  ('bdb15f73-c654-436d-b0e5-2d3450570cde', 'רב המכללה, ראש התכנית לתואר שני בזיכרון, מורשת ומחשב"י',
    'חינוך והשכלה', null),
  ('385cbaa7-9cf7-4777-a66e-35adabf1afa0', 'יועץ הידרו גיאולוגיה',
    'בנייה ומבנים', 'קרקע וביסוס'),
  ('0f16743f-f1f6-480d-8796-31e6fc5c3ae9', 'יועץ תכנון איטום',
    'בנייה ומבנים', 'איטום');

do $$
begin
  if exists (
    select 1 from remaining_category_seed s join public.registry_fields f on f.id = s.field_id
    where f.source_text <> s.source_text
  ) then
    raise exception 'source-field snapshot differs; review the remaining categories by hand';
  end if;
end $$;

-- One new subcategory, for city planners and building programmers of the planning division.
insert into public.categories (name, parent_id)
select 'תכנון ערים ופרוגרמות', r.id from public.categories r
where r.parent_id is null and r.name = 'אדריכלות ועיצוב'
  and exists (select 1 from remaining_category_seed s join public.registry_fields f
    on f.id = s.field_id where s.child_name = 'תכנון ערים ופרוגרמות')
on conflict do nothing;

do $$
begin
  if exists (
    select 1 from remaining_category_seed s
    join public.registry_fields f on f.id = s.field_id
    left join public.categories r on r.parent_id is null and r.name = s.root_name
    left join public.categories c on c.parent_id = r.id and c.name = s.child_name
    where r.id is null or not r.active
      or (s.child_name is not null and (c.id is null or not c.active))
  ) then
    raise exception 'a category in the remaining-fields mapping is missing or inactive';
  end if;
end $$;

insert into public.registry_field_categories (registry_field_id, category_id)
select s.field_id, coalesce(c.id, r.id) from remaining_category_seed s
join public.registry_fields f on f.id = s.field_id
join public.categories r on r.parent_id is null and r.name = s.root_name
left join public.categories c on c.parent_id = r.id and c.name = s.child_name
on conflict (registry_field_id, category_id) do nothing;
