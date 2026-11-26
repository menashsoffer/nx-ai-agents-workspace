-- Data fix, approved by Menash on 22.11.2026 (decision card "למזג את ה-19"; list in
-- reviews/identifier-search-2026-11-22.md in the project files). The registrar search found
-- that 19 suppliers without an identifier carry the same company or nonprofit number as
-- another supplier that already holds it, so each is the same body loaded twice.
-- Each source supplier is merged into the supplier holding the number, the way
-- public.merge_suppliers does: its name becomes a published name of the target, its
-- children move, and it is marked merged (reversible, nothing is deleted). A pair is skipped
-- unless both rows exist and are still active, so the file does nothing on staging.
-- Left separate on purpose: אלכס ברבר, אנטרופי and the two halls of בית מזיא.

create temporary table identifier_duplicates (source_id uuid primary key, target_id uuid)
  on commit drop;

insert into identifier_duplicates (source_id, target_id) values
  ('efe67c0f-e35a-465f-859f-d333c5787be6', '06db6fa5-dc61-4be1-a0a7-cf86b7318dd2'),
  ('030ac436-cc19-4d86-b20f-019fc6037969', '656b85c0-aa1f-4de6-a5c3-f8e44edb03dc'),
  ('5fd4bb46-ee50-45f2-a5da-53f60efb232b', 'ea660904-a5f0-47b8-bb24-e5e839a3f6c9'),
  ('608b1107-70d9-4f79-91b1-a4344fe77719', '97b31d7b-c60e-4d6a-a503-ffb74fc6f651'),
  ('cab173a7-f426-486b-9622-3d803cec7da2', '26b6b4ea-8f72-4dcf-9db1-ff7016fb945d'),
  ('523c8c42-8e0d-48a5-9f6d-b64fdbfc6ae5', '80c4a2cf-ae45-4b4c-ad60-d6b309f3da35'),
  ('854a2c95-abcb-4272-9fc4-cef6fb3370c2', '08884b80-db15-41e3-b09f-296077cec353'),
  ('072420e5-48fc-436a-83be-005e36b5a8b3', 'c0112d4d-a8ef-4441-ba19-c7219a59a162'),
  ('6a41b1d8-8b81-41f7-9e2d-45b8c86b25e5', '24587411-8e8b-4d13-91fa-a7f2bb06c725'),
  ('ec754aae-862a-48ad-bbeb-f84be4e9f7d4', '6fc07ead-b026-4102-a0c2-64fb76c5b722'),
  ('f5a10762-5656-4872-8639-c0e91f60d141', '6fc07ead-b026-4102-a0c2-64fb76c5b722'),
  ('225c8405-413b-4be2-b74d-8fbaf1bcc5d9', '400f4d5f-69c7-4983-9598-77289294e296'),
  ('87281aa0-c314-47f0-9fe1-61566ff68d59', '1cd979b7-824b-4951-885a-df96a03ed8f9'),
  ('ccf1cc82-eea3-47ec-bb5d-7bfd76419b69', '416f3f06-995f-49a9-8ddd-da061a4e7072'),
  ('fe356b43-c8a4-41b8-9633-b7185cbd703e', 'fbe76887-6a01-4aad-8af5-3a95f0f33059'),
  ('d4790ae5-de53-4536-91fe-1ef2ce5b100e', '4353b10e-7443-4e66-ac18-0d5610ee8f51'),
  ('3039f3e7-a027-49bc-8f8c-c98c2fcdd8fb', '7fa801fb-bfb9-47b4-adc9-b51ba8e641e0'),
  ('f52f1a2d-a551-452f-bb88-2ce154c5cfea', '0a59deb9-1b14-4464-b051-4eb0998c191b'),
  ('8093bb5a-9c8f-4002-aaaa-321c35157278', '3d45684b-0a15-47fd-bb42-3192397b4473');

do $$
declare
  pair record;
begin
  for pair in
    select d.source_id, d.target_id, s.display_name
    from identifier_duplicates d
    join public.suppliers s on s.id = d.source_id and s.status = 'active'
    join public.suppliers t on t.id = d.target_id and t.status = 'active'
    order by d.source_id
  loop
    insert into public.supplier_names (supplier_id, name, kind)
    values (pair.target_id, pair.display_name, 'as_published')
    on conflict do nothing;
    perform private.move_supplier_children(pair.source_id, pair.target_id);
    update public.suppliers set status = 'merged', merged_into_id = pair.target_id
    where id = pair.source_id;
  end loop;
end;
$$;
