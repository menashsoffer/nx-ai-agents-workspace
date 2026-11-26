-- Dummy data for the local database and the staging project. Never applied to production.
-- Every name, number and link here is invented. Safe to run more than once.

insert into public.org_units (id, name, kind, parent_id, verified) values
  ('d0000000-0000-0000-0000-000000000001', 'מינהל לדוגמה', 'administration', null, true),
  ('d0000000-0000-0000-0000-000000000002', 'אגף בדיקות א', 'department',
    'd0000000-0000-0000-0000-000000000001', true),
  ('d0000000-0000-0000-0000-000000000003', 'אגף בדיקות ב', 'department',
    'd0000000-0000-0000-0000-000000000001', true)
on conflict (id) do nothing;

insert into public.source_documents (id, url, file_name, published_on, note) values
  ('d1000000-0000-0000-0000-000000000001', 'https://example.test/registry-a.pdf',
    'registry-a.pdf', '2026-01-15', 'מסמך דמה')
on conflict (id) do nothing;

insert into public.registries (id, name, owner_unit_id, kind) values
  ('d2000000-0000-0000-0000-000000000001', 'מאגר יועצים לדוגמה',
    'd0000000-0000-0000-0000-000000000002', 'consultants_3_8'),
  ('d2000000-0000-0000-0000-000000000002', 'רשימת ספקים לדוגמה',
    'd0000000-0000-0000-0000-000000000003', 'zuta_suppliers_8')
on conflict (id) do nothing;

insert into public.registry_versions (id, registry_id, source_document_id, valid_from) values
  ('d3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001', '2026-01-15'),
  ('d3000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', null, null)
on conflict (id) do nothing;

insert into public.categories (id, name) values
  ('d4000000-0000-0000-0000-000000000001', 'הנדסה לדוגמה'),
  ('d4000000-0000-0000-0000-000000000002', 'ייעוץ ארגוני לדוגמה')
on conflict (id) do nothing;

insert into public.registry_fields (id, registry_id, source_text, category_id) values
  ('d5000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001',
    'תכנון מבנים', 'd4000000-0000-0000-0000-000000000001'),
  ('d5000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001',
    'ליווי תהליכים', 'd4000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into public.registry_field_categories (registry_field_id, category_id) values
  ('d5000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001'),
  ('d5000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000002')
on conflict (registry_field_id, category_id) do nothing;

insert into public.suppliers (id, display_name, entity_kind) values
  ('d6000000-0000-0000-0000-000000000001', 'חברת דמה הנדסה בע"מ', 'company'),
  ('d6000000-0000-0000-0000-000000000002', 'עמותת דמה לייעוץ', 'nonprofit'),
  ('d6000000-0000-0000-0000-000000000003', 'יועץ דמה', 'sole_trader')
on conflict (id) do nothing;

insert into public.memberships (id, supplier_id, registry_version_id, registry_field_id,
  name_as_published, source_page, dates_source) values
  ('d7000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001',
    'חברת דמה הנדסה', 3, 'registry_document'),
  ('d7000000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000002',
    'd3000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000002',
    'עמותת דמה', 4, 'registry_document'),
  ('d7000000-0000-0000-0000-000000000003', 'd6000000-0000-0000-0000-000000000003',
    'd3000000-0000-0000-0000-000000000002', null, 'יועץ דמה', null, 'unknown')
on conflict (id) do nothing;
