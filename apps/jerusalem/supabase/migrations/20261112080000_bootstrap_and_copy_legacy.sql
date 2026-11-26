-- One-time data step: keep today's admins as admins, then copy every legacy row
-- into staging and promote what is unambiguous. legacy_suppliers is not changed.
-- Reconciliation: legacy rows = import rows = promoted + duplicate.

insert into public.profiles (
  user_id, first_name, last_name, email, job_title, purpose, status, reviewed_at
)
select u.id,
  coalesce(nullif(split_part(u.raw_user_meta_data ->> 'full_name', ' ', 1), ''), 'מנהל'),
  coalesce(nullif(trim(substr(u.raw_user_meta_data ->> 'full_name',
    length(split_part(u.raw_user_meta_data ->> 'full_name', ' ', 1)) + 1)), ''), 'מערכת'),
  u.email, 'מנהל מערכת', 'ניהול המערכת, הועבר מהתפקיד הקודם', 'active', now()
from auth.users u
where u.raw_app_meta_data ->> 'role' = 'supplier_admin' and u.email is not null
on conflict (user_id) do nothing;

insert into public.role_grants (user_id, role)
select p.user_id, 'admin'
from public.profiles p
join auth.users u on u.id = p.user_id
where u.raw_app_meta_data ->> 'role' = 'supplier_admin'
on conflict do nothing;

create temporary table legacy_rows on commit drop as
select l.*,
  private.normalize_name(l.name) as normalized,
  substring(l.note from 'קוד תחום: *([0-9]+(\.[0-9]+)*)') as field_code,
  substring(l.note from 'תוקף המאגר עד *([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})') as registry_until,
  substring(l.note from 'תוקף חוזה[^0-9]*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})') as listed_until,
  min(l.id) over (partition by l.name, l.field, l.registry, l.source_url, l.email,
    l.phone, l.note) as first_id
from public.legacy_suppliers l;

insert into public.source_documents (url, note)
select distinct source_url, 'הועבר מהטבלה הקודמת'
from legacy_rows where source_url is not null;

insert into public.registries (name, keeper)
select distinct trim(registry), 'municipality' from legacy_rows
on conflict do nothing;

insert into public.registry_versions (registry_id, source_document_id, valid_until)
select r.id, d.id, max(to_date(l.registry_until, 'DD.MM.YYYY'))
from legacy_rows l
join public.registries r on lower(r.name) = lower(trim(l.registry))
left join public.source_documents d on d.url = l.source_url
group by r.id, d.id;

create temporary table legacy_versions on commit drop as
select distinct l.id as legacy_id, v.id as version_id, v.registry_id, v.source_document_id
from legacy_rows l
join public.registries r on lower(r.name) = lower(trim(l.registry))
join public.registry_versions v on v.registry_id = r.id
  and v.source_document_id is not distinct from (
    select d.id from public.source_documents d where d.url = l.source_url);

insert into public.import_batches (
  source_document_id, registry_id, registry_version_id, script_name, note
)
select distinct source_document_id, registry_id, version_id, 'legacy_suppliers_copy',
  'העתקה מטבלת suppliers הקודמת'
from legacy_versions;

create temporary table legacy_import on commit drop as
select l.id as legacy_id, b.id as batch_id, lv.version_id,
  row_number() over (partition by b.id order by l.id) as row_number
from legacy_rows l
join legacy_versions lv on lv.legacy_id = l.id
join public.import_batches b on b.registry_version_id = lv.version_id;

insert into public.import_rows (batch_id, row_number, source_page, raw)
select i.batch_id, i.row_number, l.source_page,
  to_jsonb(l) - 'normalized' - 'field_code' - 'registry_until' - 'listed_until' - 'first_id'
from legacy_import i join legacy_rows l on l.id = i.legacy_id;

create temporary table legacy_map on commit drop as
select i.legacy_id, i.version_id, r.id as import_row_id, l.first_id
from legacy_import i
join legacy_rows l on l.id = i.legacy_id
join public.import_rows r on r.batch_id = i.batch_id and r.row_number = i.row_number;

update public.import_rows r
set status = 'duplicate', duplicate_of = first.import_row_id,
  reviewer_note = 'שורה זהה לחלוטין לשורה קודמת'
from legacy_map m
join legacy_map first on first.legacy_id = m.first_id
where r.id = m.import_row_id and m.legacy_id <> m.first_id;

-- One supplier per normalized name. Different entities that share a name are split
-- later by a person, once company numbers are known.
insert into public.suppliers (display_name)
select distinct on (l.normalized) trim(l.name)
from legacy_rows l
where l.normalized is not null
order by l.normalized, length(trim(l.name)), trim(l.name);

create temporary table legacy_supplier on commit drop as
select l.id as legacy_id, s.id as supplier_id
from legacy_rows l
join public.suppliers s on s.normalized_name = l.normalized and s.status = 'active';

insert into public.supplier_names (supplier_id, name, kind, source_document_id)
select distinct on (ls.supplier_id, private.normalize_name(l.name))
  ls.supplier_id, trim(l.name), 'as_published', lv.source_document_id
from legacy_rows l
join legacy_supplier ls on ls.legacy_id = l.id
join legacy_versions lv on lv.legacy_id = l.id
on conflict do nothing;

insert into public.supplier_contacts (supplier_id, kind, value, source_document_id)
select distinct on (ls.supplier_id, c.kind, c.normalized)
  ls.supplier_id, c.kind, c.value, lv.source_document_id
from legacy_rows l
join legacy_supplier ls on ls.legacy_id = l.id
join legacy_versions lv on lv.legacy_id = l.id
cross join lateral (
  select 'email' as kind, trim(e) as value, lower(trim(e)) as normalized
  from regexp_split_to_table(coalesce(l.email, ''), '[,;\s]+') e
  where trim(e) <> ''
  union all
  select 'phone', trim(p), regexp_replace(p, '[^0-9+]', '', 'g')
  from regexp_split_to_table(coalesce(l.phone, ''), '[,;/]+') p
  where trim(p) <> ''
) c
on conflict do nothing;

-- A legacy field like "a / b" lists two fields of the same registry.
create temporary table legacy_fields on commit drop as
select distinct l.id as legacy_id, lv.registry_id, trim(f) as source_text, l.field_code
from legacy_rows l
join legacy_versions lv on lv.legacy_id = l.id
cross join lateral unnest(string_to_array(l.field, ' / ')) f
where trim(f) <> '';

insert into public.registry_fields (registry_id, source_text, source_code)
select registry_id, min(source_text), max(field_code)
from legacy_fields
group by registry_id, lower(source_text)
on conflict do nothing;

-- "תוקף חוזה" in the source is read as the end of the listing and kept for review.
insert into public.memberships (
  supplier_id, registry_version_id, registry_field_id, name_as_published, source_page,
  registered_until, dates_source, import_row_id, note
)
select distinct on (ls.supplier_id, m.version_id, rf.id)
  ls.supplier_id, m.version_id, rf.id, trim(l.name), l.source_page,
  to_date(l.listed_until, 'DD.MM.YYYY'),
  case when l.listed_until is null then 'unknown' else 'registry_document' end,
  m.import_row_id,
  nullif(l.note, 'חולץ אוטומטית – יש לאמת מול המקור')
from legacy_map m
join legacy_rows l on l.id = m.legacy_id
join legacy_supplier ls on ls.legacy_id = l.id
join legacy_fields lf on lf.legacy_id = l.id
join public.registry_fields rf on rf.registry_id = lf.registry_id
  and lower(rf.source_text) = lower(lf.source_text)
where m.legacy_id = m.first_id
order by ls.supplier_id, m.version_id, rf.id, l.id
on conflict do nothing;

update public.import_rows r
set status = 'promoted'
from legacy_map m
where r.id = m.import_row_id and m.legacy_id = m.first_id;

update public.import_batches b
set row_count = (select count(*) from public.import_rows r where r.batch_id = b.id),
  status = 'in_review'
where b.script_name = 'legacy_suppliers_copy';
