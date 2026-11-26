-- Accounts for the browser tests (e2e/). Local database only: the tests run it after
-- `supabase start`, on top of supabase/seed/dummy.sql. Every value here is invented.
-- The password is the same for all accounts; it is not a secret, it only exists locally.

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
  email, extensions.crypt('e2e-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (values
  ('e2e00000-0000-0000-0000-00000000000a', 'admin@e2e.test'),
  ('e2e00000-0000-0000-0000-00000000000c', 'editor@e2e.test'),
  ('e2e00000-0000-0000-0000-0000000000a1', 'supplier@e2e.test')
) as u(id, email)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at,
  updated_at, last_sign_in_at)
select gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from auth.users where email like '%@e2e.test'
  and not exists (select 1 from auth.identities i where i.user_id = auth.users.id);

insert into public.profiles (user_id, first_name, last_name, email, job_title, unit_id,
  purpose, status, reviewed_at) values
  ('e2e00000-0000-0000-0000-00000000000a', 'מנהלת', 'בדיקות', 'admin@e2e.test', 'מנהלת מערכת',
    'd0000000-0000-0000-0000-000000000002', 'בדיקות דפדפן', 'active', now()),
  ('e2e00000-0000-0000-0000-00000000000c', 'עורך', 'בדיקות', 'editor@e2e.test', 'רכז רכש',
    'd0000000-0000-0000-0000-000000000002', 'בדיקות דפדפן', 'active', now())
on conflict (user_id) do nothing;

insert into public.role_grants (user_id, role, unit_id) values
  ('e2e00000-0000-0000-0000-00000000000a', 'admin', null),
  ('e2e00000-0000-0000-0000-00000000000c', 'editor', 'd0000000-0000-0000-0000-000000000002')
on conflict do nothing;

-- A supplier-side person who owns the dummy nonprofit's personal area.
insert into public.supplier_accounts (user_id, supplier_id, role, status, method, decided_at)
values ('e2e00000-0000-0000-0000-0000000000a1', 'd6000000-0000-0000-0000-000000000002', 'owner',
  'active', 'invite', now())
on conflict do nothing;
insert into public.portal_people (user_id, first_name, last_name) values
  ('e2e00000-0000-0000-0000-0000000000a1', 'דנה', 'ספקית')
on conflict (user_id) do nothing;

-- Two supplier ID candidates for the screen checks (e2e/screens): a short name and a long one,
-- so the list shows that both keep the same line layout.
insert into public.suppliers (id, display_name, entity_kind) values
  ('e2e00000-0000-0000-0000-0000000000b1',
    'חברת דמה למערכות ניהול נוכחות, מצוקה ובקרת עובדים מהשטח בע"מ', 'company')
on conflict (id) do nothing;
insert into public.identifier_candidates (id, supplier_id, scheme, value, source,
  registrar_name, registrar_status, searched_name) values
  ('e2e00000-0000-0000-0000-0000000000c1', 'd6000000-0000-0000-0000-000000000003', 'company',
    '512345678', 'companies_registrar', 'יועץ דמה בע"מ', 'פעילה', 'יועץ דמה'),
  ('e2e00000-0000-0000-0000-0000000000c2', 'e2e00000-0000-0000-0000-0000000000b1', 'company',
    '513396234', 'companies_registrar',
    'חברת דמה למערכות ניהול נוכחות, מצוקה ובקרת עובדים מהשטח בע"מ', 'פעילה',
    'חברת דמה למערכות ניהול נוכחות')
on conflict (id) do nothing;

-- A kind suggestion, so the screen checks cover that list too.
insert into public.kind_suggestions (id, supplier_id, suggested_kind, strength, reasons) values
  ('e2e00000-0000-0000-0000-0000000000d1', 'e2e00000-0000-0000-0000-0000000000b1', 'company',
    'medium', '[{"source": "name", "kind": "company"}]')
on conflict (id) do nothing;
