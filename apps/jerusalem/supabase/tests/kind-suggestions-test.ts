// Kind suggestions for suppliers whose kind is unknown (supplier-edit-checks-spec-he.md, 3).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';
import { BARE, CHANGE_FIXTURE, NEIGHBOUR, failure } from './supplier-change-fixture.ts';

const NONPROFIT = '42000000-0000-0000-0000-000000000001';
const CLASH = '42000000-0000-0000-0000-000000000002';
const REGISTERED = '42000000-0000-0000-0000-000000000003';

// SUPPLIER ('ספק') holds a waiting company number and a personal ID: two kinds, no suggestion.
// BARE is 'מרכז הסעות בע"מ' with no number: the name suggests a company.
const FIXTURE = `
  insert into public.suppliers (id, display_name, entity_kind) values
    ('${NONPROFIT}', 'עזרה לשכן', 'unknown'),
    ('${CLASH}', 'עמותת אור בע"מ', 'unknown'),
    ('${REGISTERED}', 'קואופ', 'unknown');
  insert into public.supplier_identifiers (supplier_id, scheme, value, review_status,
    registry_details) values
    ('${NONPROFIT}', 'nonprofit', '580000001', 'needs_review', null),
    ('${REGISTERED}', 'company', '570000001', 'verified', '{"סוג תאגיד": "חברה פרטית"}');
`;

interface Suggestion {
  id: string;
  supplier_id: string;
  suggested_kind: string;
  strength: string;
  status: string;
  request_id: string | null;
}

async function run(db: PGlite, user: string) {
  return as(db, user, async () => {
    const { rows } = await db.query<{ v: { created: number; unknown: number } }>(
      'select public.suggest_supplier_kinds() as v',
    );
    return rows[0]?.v;
  });
}

async function suggestionFor(db: PGlite, supplier: string): Promise<Suggestion | undefined> {
  const { rows } = await db.query<Suggestion>(
    'select * from public.kind_suggestions where supplier_id = $1 order by created_at desc',
    [supplier],
  );
  return rows[0];
}

function decide(db: PGlite, user: string, choice: { id: string; accept: boolean }) {
  return as(db, user, async () => {
    const { rows } = await db.query<{ v: string }>(
      'select public.decide_kind_suggestion($1, $2) as v',
      [choice.id, choice.accept],
    );
    return rows[0]?.v;
  });
}

describe('kind suggestions', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(CHANGE_FIXTURE);
    await db.exec(FIXTURE);
  });
  after(async () => db.close());

  it('lets only an admin run the suggestions', async () => {
    assert.match(await failure(run(db, USERS.editor)), /PT403/u);
  });

  it('suggests from the registry, a waiting number or the name, and never on a clash', async () => {
    const result = await run(db, USERS.admin);
    assert.equal(result?.created, 3);
    const registered = await suggestionFor(db, REGISTERED);
    assert.deepEqual([registered?.suggested_kind, registered?.strength], ['company', 'strong']);
    const nonprofit = await suggestionFor(db, NONPROFIT);
    assert.deepEqual([nonprofit?.suggested_kind, nonprofit?.strength], ['nonprofit', 'medium']);
    assert.equal((await suggestionFor(db, BARE))?.suggested_kind, 'company');
    for (const none of [SUPPLIER, CLASH, NEIGHBOUR]) {
      assert.equal(await suggestionFor(db, none), undefined, none);
    }
    assert.equal((await run(db, USERS.admin))?.created, 0, 'no second waiting suggestion');
  });

  it('shows suggestions to staff only', async () => {
    const seen = (user: string) =>
      as(db, user, () => db.query('select id from public.kind_suggestions').then((r) => r.rows));
    assert.equal((await seen(USERS.editor)).length, 3);
    assert.equal((await seen(USERS.viewer)).length, 0);
    const write = as(db, USERS.admin, () => db.query('delete from public.kind_suggestions'));
    assert.match(await failure(write), /42501/u);
  });

  it('sends an accepted suggestion through the kind change checks', async () => {
    const suggestion = await suggestionFor(db, NONPROFIT);
    if (!suggestion) throw new Error('No suggestion');
    // The kind fits the waiting number, so the change is green and saved at once.
    assert.equal(await decide(db, USERS.editor, { id: suggestion.id, accept: true }), 'applied');
    const accepted = await suggestionFor(db, NONPROFIT);
    const kind = await db.query<{ entity_kind: string }>(
      'select entity_kind from public.suppliers where id = $1',
      [NONPROFIT],
    );
    assert.equal(kind.rows[0]?.entity_kind, 'nonprofit');
    assert.equal(accepted?.status, 'accepted');
    const { rows } = await db.query<{ new_value: string; reason: string }>(
      'select new_value, reason from public.supplier_change_requests where id = $1',
      [accepted.request_id],
    );
    assert.equal(rows[0]?.new_value, 'nonprofit');
    assert.match(rows[0].reason, /מספר עמותה ממתין/u);
    const again = decide(db, USERS.editor, { id: suggestion.id, accept: true });
    assert.match(await failure(again), /PT404/u);
  });

  it('remembers a rejection and drops a suggestion once the kind is known', async () => {
    const bare = await suggestionFor(db, BARE);
    if (!bare) throw new Error('No suggestion');
    assert.equal(await decide(db, USERS.editor, { id: bare.id, accept: false }), 'rejected');
    assert.equal(
      (await run(db, USERS.admin))?.created,
      0,
      'a rejected kind is not suggested again',
    );
    const registered = await suggestionFor(db, REGISTERED);
    if (!registered) throw new Error('No suggestion');
    await db.exec(`update public.suppliers set entity_kind = 'company' where id = '${REGISTERED}'`);
    assert.equal(await decide(db, USERS.admin, { id: registered.id, accept: true }), 'outdated');
    assert.match(
      await failure(decide(db, USERS.viewer, { id: registered.id, accept: false })),
      /PT403/u,
    );
  });
});
