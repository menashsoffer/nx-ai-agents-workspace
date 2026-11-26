-- Data fix, approved by Menash on 22.11.2026 (report: reviews/duplicate-addresses-2026-11-22.md
-- in the project files). The pool-file loads of 17.11 gave 10 suppliers two addresses, because
-- addresses are unique only by exact text, and stored 9 addresses with reversed Hebrew.
-- The redundant address is marked outdated (reversible, nothing is deleted) and the reversed
-- addresses are written in the right order. Rows are matched by id and by their current text,
-- so the file does nothing on staging or on a row that was already edited.
-- Pilat (two different addresses) is left as is until Menash chooses.

update public.supplier_contacts as c set status = 'outdated'
from (values
  ('c073747f-fd01-47cd-84bc-02288664d297'::uuid, 'ביבא לת 26 רודגיבא ןב'),
  ('678b01ce-086b-46ab-84c7-eade188bd44c'::uuid, 'הברזל 34, תל אביב-יפו 6971050'),
  ('8342e087-8bbb-4e61-a8e8-2459ff60bc1e'::uuid,
    'כנפי נשרים 23, ירושלים (באתר: כנפי נשרים 35, גבעת שאול, ירושלים)'),
  ('51415b6b-ce41-49b0-b4fd-bc866bc13594'::uuid, 'מרכז עזריאלי 1 / יגאל אלון 98, תל אביב'),
  ('dd011964-0f52-4bcc-98ad-ad22eb83767d'::uuid, 'ירושלים'),
  ('ca594900-8982-4c0b-a7a1-dcadab1595d5'::uuid, 'הנביאים 37 (ת.ד. 1114), ירושלים 91010'),
  ('a8e39cdd-e27a-47f4-88c3-a5d6ee7b22d0'::uuid, 'גולדה מאיר 5, נס ציונה, 7403649'),
  ('081a5c16-0b9e-4416-a01e-eba26cdd39e7'::uuid,
    'שד'' הנשיא 77, חיפה 3464208; דרך מנחם בגין 156, תל אביב'),
  ('b8b1d3aa-7a33-4d27-afe4-10cf9162a471'::uuid, 'העליה השניה 43, אזור 5800239')
) as v(id, old_value)
where c.id = v.id and c.value = v.old_value and c.kind = 'address' and c.status = 'current';

update public.supplier_contacts as c set value = v.fixed
from (values
  ('4b1d091b-77e6-4f3b-a1a2-4a33b6a03567'::uuid, 'תיז תיב 283 םגאה', 'האגם 283 בית זית'),
  ('eade39e2-72e1-4e89-be9e-f3f0271c1d0d'::uuid, 'דירש ןיע 31 תיעלס', 'סלעית 31 עין שריד'),
  ('0bae0d01-9c34-4b82-9f8a-b0cdb90bc963'::uuid, 'םילשורי 38 ילבב הנח בוחר',
    'רחוב חנה בבלי 38 ירושלים'),
  ('04130a3b-fae3-46ca-af8d-868dc3d59644'::uuid, 'הינתנ 3 ןמטיח יזוע', 'עוזי חיטמן 3 נתניה'),
  ('bcca51b3-4506-48c2-b332-20dd78363c68'::uuid, 'םילשורי ףונ רה 8 בייט ייח',
    'חיי טייב 8 הר נוף ירושלים'),
  ('1bae6e10-3d3e-45fd-8c69-0b70e1a4ce6e'::uuid, '69483 ביבא לת 24 שא םולש',
    'שלום אש 24 תל אביב 69483'),
  ('9c59421c-1dfa-4d58-89ea-64731ace62d6'::uuid, '9109002 םילשורי 9080 ד.ת',
    'ת.ד 9080 ירושלים 9109002'),
  ('5e979e04-3be5-40ac-bce1-092f1414922c'::uuid, 'םילשורי 11 יכדרמ יפסכ',
    'כספי מרדכי 11 ירושלים')
) as v(id, old_value, fixed)
where c.id = v.id and c.value = v.old_value and c.kind = 'address' and c.status = 'current';
