begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);
select has_column('public', 'import_rows', 'decision', 'import_rows.decision exists');
select has_column('public', 'import_rows', 'target_supplier_id',
  'import_rows.target_supplier_id exists');
select has_column('public', 'import_rows', 'edited', 'import_rows.edited exists');
select has_column('public', 'import_rows', 'error', 'import_rows.error exists');
select has_column('public', 'source_documents', 'storage_path',
  'source_documents.storage_path exists');
select col_is_null('public', 'source_documents', 'url', 'source URL is optional');
select has_function('public', 'stage_excel_import', array['jsonb']);
select has_function('public', 'decide_import_rows', array['jsonb']);
select has_function('public', 'apply_import_batch', array['uuid']);
select ok((select not public and file_size_limit = 5242880 from storage.buckets
  where id = 'source-files'), 'source bucket is private and limited to 5 MiB');
select ok(not has_function_privilege('anon', 'public.stage_excel_import(jsonb)', 'execute'),
  'anonymous users cannot stage imports');
select ok(not has_function_privilege('anon', 'public.decide_import_rows(jsonb)', 'execute'),
  'anonymous users cannot decide imports');
select ok(not has_function_privilege('anon', 'public.apply_import_batch(uuid)', 'execute'),
  'anonymous users cannot apply imports');
select is((select count(*)::integer from pg_policies where schemaname = 'storage'
  and tablename = 'objects' and policyname like 'source_files_%'), 4,
  'source file operations have dedicated policies');
select ok((select pg_get_triggerdef(oid) like '%edited%' and pg_get_triggerdef(oid) like '%raw%'
  from pg_trigger where tgrelid = 'public.import_rows'::regclass and tgname = 'audit_row'),
  'import row audit hides source and edited values');
insert into auth.users (id) values
  ('18800000-0000-0000-0000-000000000001'), ('18800000-0000-0000-0000-000000000002');
insert into public.profiles (user_id, first_name, last_name, email, job_title, purpose, status,
  reviewed_at) values
  ('18800000-0000-0000-0000-000000000001', 'Admin', 'Test', 'admin-test@example.test', 'staff',
    'testing import', 'active', now()),
  ('18800000-0000-0000-0000-000000000002', 'Audit', 'Test', 'audit-test@example.test', 'staff',
    'testing import', 'active', now());
insert into public.role_grants (user_id, role) values
  ('18800000-0000-0000-0000-000000000001', 'admin'),
  ('18800000-0000-0000-0000-000000000002', 'auditor');
insert into public.suppliers (id, display_name) values
  ('48800000-0000-0000-0000-000000000001', 'Excel test supplier');
insert into public.supplier_contacts (supplier_id, kind, value, is_primary) values
  ('48800000-0000-0000-0000-000000000001', 'email', 'original@example.test', true);
insert into storage.objects (bucket_id, name, metadata)
  values ('source-files', 'excel/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.xlsx', '{"size": 500}');
select set_config('request.jwt.claims',
  '{"sub":"18800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temporary table excel_test as
select public.stage_excel_import(jsonb_build_object(
  'file_name', 'pgtap-test.xlsx', 'storage_path', 'excel/' || repeat('c', 64) || '.xlsx',
  'content_sha256', repeat('c', 64), 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'raw', '{"name":"Excel test supplier"}'::jsonb,
      'edited', '{"name":"Excel test supplier","email":"new@example.test"}'::jsonb),
    jsonb_build_object('row_number', 3, 'raw', '{"name":""}'::jsonb,
      'edited', '{"name":""}'::jsonb)))) as result;
select is((select jsonb_array_length(result -> 'rows' -> 0 -> 'candidates') from excel_test), 1,
  'matching supplier is proposed');
select is((select count(*)::integer from public.import_rows where batch_id =
  (select (result ->> 'batch_id')::uuid from excel_test) and target_supplier_id is not null), 0,
  'staging does not link a supplier');
select is((public.apply_import_batch((select (result ->> 'batch_id')::uuid from excel_test))
  ->> 'pending')::integer, 2, 'undecided rows stay pending');
select is(public.decide_import_rows(jsonb_build_array(
  jsonb_build_object('row_id', (select result -> 'rows' -> 0 ->> 'row_id' from excel_test),
    'decision', 'link', 'target_supplier_id', '48800000-0000-0000-0000-000000000001',
    'edited', '{"name":"Excel test supplier","email":"new@example.test"}'::jsonb),
  jsonb_build_object('row_id', (select result -> 'rows' -> 1 ->> 'row_id' from excel_test),
    'decision', 'new', 'edited', '{"name":""}'::jsonb))), 2, 'administrator decides rows');
create temporary table excel_applied as
select public.apply_import_batch((select (result ->> 'batch_id')::uuid from excel_test)) as result;
select is((select (result ->> 'promoted')::integer from excel_applied), 1,
  'valid row is promoted despite a failing row');
select is((select (result ->> 'failed')::integer from excel_applied), 1,
  'invalid row stays pending');
select is((select count(*)::integer from public.supplier_contacts where
  supplier_id = '48800000-0000-0000-0000-000000000001' and is_primary
  and value = 'original@example.test'), 1, 'existing primary contact is unchanged');
select is((select count(*)::integer from public.supplier_contacts where
  supplier_id = '48800000-0000-0000-0000-000000000001' and not is_primary
  and value = 'new@example.test'), 1, 'new contact is an alternate');
select is((public.apply_import_batch((select (result ->> 'batch_id')::uuid from excel_test))
  ->> 'promoted')::integer, 0, 'reapplying does not promote a row twice');
select is((select count(*)::integer from public.suppliers where
  id = '48800000-0000-0000-0000-000000000001' and review_status = 'verified'), 0,
  'import does not verify a supplier');
select is((public.stage_excel_import(jsonb_build_object(
  'file_name', 'pgtap-test.xlsx', 'storage_path', 'excel/' || repeat('c', 64) || '.xlsx',
  'content_sha256', repeat('c', 64), 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'raw', '{}'::jsonb, 'edited', '{}'::jsonb))))
  ->> 'duplicate')::boolean, true, 're-uploading the same file detects the batch');
select set_config('request.jwt.claims',
  '{"sub":"18800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok('select public.stage_excel_import(''{}''::jsonb)', '42501', 'Not authorized',
  'auditor cannot stage');
select throws_ok('select public.decide_import_rows(''[]''::jsonb)', '42501', 'Not authorized',
  'auditor cannot decide');
select throws_ok('select public.apply_import_batch(null)', '42501', 'Not authorized',
  'auditor cannot apply');
select is((select count(*)::integer from public.import_rows), 0,
  'auditor cannot read import rows directly');
select is((select count(*)::integer from storage.objects where bucket_id = 'source-files'), 0,
  'auditor cannot read source files directly');
select is((select count(*)::integer from public.source_documents where storage_path is not null), 0,
  'auditor cannot read source file metadata');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('source-files', 'blocked.xlsx')$$,
  '42501', null, 'auditor cannot upload source files');
reset role;
select is((select raw ->> 'name' from public.import_rows where id =
  (select (result -> 'rows' -> 0 ->> 'row_id')::bigint from excel_test)), 'Excel test supplier',
  'source row remains unchanged after promotion');
select * from finish();
rollback;
