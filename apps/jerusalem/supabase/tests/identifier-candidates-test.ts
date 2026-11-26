import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

interface Candidate {
  id: string;
  value: string;
  registrar_name: string;
}

const FOUND = [
  {
    scheme: 'company',
    value: '515301596',
    source: 'companies_registrar',
    registrar_name: 'א',
    registrar_status: 'פעילה',
    searched_name: 'ספק',
  },
  {
    scheme: 'nonprofit',
    value: '580000001',
    source: 'guidestar',
    registrar_name: 'ב',
    registrar_status: 'רשומה',
    searched_name: 'ספק',
  },
  // The fixture supplier already has this company number.
  {
    scheme: 'company',
    value: '512345678',
    source: 'companies_registrar',
    registrar_name: 'ג',
    registrar_status: 'פעילה',
    searched_name: 'ספק',
  },
];

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function lookupInput(db: PGlite, user: string | null, target = SUPPLIER) {
  return as(db, user, async () => {
    const result = await db.query<{ input: { user_id: string; names: string[] } }>(
      'select public.identifier_lookup_input($1) as input',
      [target],
    );
    return result.rows[0]?.input;
  });
}

async function save(db: PGlite, found: unknown[]): Promise<Candidate[]> {
  await db.exec('set role service_role');
  try {
    const result = await db.query<{ saved: Candidate[] }>(
      'select public.save_identifier_candidates($1, $2, $3) as saved',
      [SUPPLIER, USERS.editor, JSON.stringify(found)],
    );
    return result.rows[0]?.saved ?? [];
  } finally {
    await db.exec('reset role');
  }
}

function decide(db: PGlite, user: string, choice: { id: string; accept: boolean }) {
  return as(db, user, () =>
    db.query('select public.decide_identifier_candidate($1, $2)', [choice.id, choice.accept]),
  );
}

describe('identifier candidates', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.supplier_names (supplier_id, name, kind)
      values ('${SUPPLIER}', 'שם מסחרי', 'trade_name')`);
  });
  after(async () => {
    await db.close();
  });

  it('gives editors the names to search, and refuses viewers and anonymous callers', async () => {
    const input = await lookupInput(db, USERS.editor);
    assert.deepEqual(input?.names, ['ספק', 'שם מסחרי']);
    assert.ok(await lookupInput(db, USERS.manager));
    assert.equal(await errorCode(lookupInput(db, USERS.viewer)), 'PT403');
    assert.equal(await errorCode(lookupInput(db, USERS.auditor)), 'PT403');
    assert.equal(await errorCode(lookupInput(db, null)), '42501');
    const unknown = '40000000-0000-0000-0000-0000000000ff';
    assert.equal(await errorCode(lookupInput(db, USERS.editor, unknown)), 'PT404');
  });

  it('stops a user after 30 lookups in an hour', async () => {
    await db.exec(`update private.call_quota set calls = 30
      where user_id = '${USERS.manager}' and bucket = 'supplier_identifiers'`);
    assert.equal(await errorCode(lookupInput(db, USERS.manager)), 'PT429');
    assert.ok(await lookupInput(db, USERS.editor));
  });

  it('stores candidates once, skipping numbers the supplier already has', async () => {
    const saved = await save(db, FOUND);
    assert.deepEqual(saved.map((c) => c.value).sort(), ['515301596', '580000001']);
    const again = await save(db, [{ ...FOUND[0], registrar_name: 'א חדש' }]);
    assert.equal(again.length, 2);
    assert.equal(again.find((c) => c.value === '515301596')?.registrar_name, 'א חדש');
  });

  it('stores a number found twice in one lookup only once', async () => {
    const twice = { ...FOUND[0], value: '515000001', searched_name: 'שם מסחרי' };
    const fromGuidestar = { ...twice, source: 'guidestar', registrar_name: 'ד' };
    const saved = await save(db, [twice, { ...twice, searched_name: 'ספק' }, fromGuidestar]);
    const matches = saved.filter((c) => c.value === '515000001');
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.registrar_name, 'א', 'the registrar wins');
    await db.exec("delete from public.identifier_candidates where value = '515000001'");
  });

  it('lets only the service role store candidates', async () => {
    const call = as(db, USERS.admin, () =>
      db.query("select public.save_identifier_candidates($1, $1, '[]')", [SUPPLIER]),
    );
    assert.equal(await errorCode(call), '42501');
  });

  it('shows candidates to administrators only (decision 18.11.2026)', async () => {
    const read = (user: string) =>
      as(db, user, () => count(db, 'select 1 from public.identifier_candidates'));
    assert.equal(await read(USERS.admin), 2);
    assert.equal(await read(USERS.editor), 0);
    assert.equal(await read(USERS.manager), 0);
    assert.equal(await read(USERS.viewer), 0);
    assert.equal(await read(USERS.auditor), 0);
  });

  it('turns an accepted candidate into an identifier that still needs review', async () => {
    const [company] = (await save(db, [])).filter((c) => c.value === '515301596');
    assert.ok(company);
    for (const user of [USERS.viewer, USERS.editor, USERS.manager]) {
      assert.equal(await errorCode(decide(db, user, { id: company.id, accept: true })), '42501');
    }
    await decide(db, USERS.admin, { id: company.id, accept: true });
    const added = await db.query<{ review_status: string; source: string; created_by: string }>(
      "select review_status, source, created_by from public.supplier_identifiers where value = '515301596'",
    );
    assert.deepEqual(added.rows, [
      { review_status: 'needs_review', source: 'companies_registrar', created_by: USERS.admin },
    ]);
    assert.equal(
      await errorCode(decide(db, USERS.admin, { id: company.id, accept: true })),
      'P0002',
    );
    assert.equal((await save(db, [FOUND[0]])).length, 1, 'not offered again');
  });

  it('keeps a dismissed candidate out of later results', async () => {
    const [nonprofit] = await save(db, []);
    assert.ok(nonprofit);
    await decide(db, USERS.admin, { id: nonprofit.id, accept: false });
    assert.deepEqual(await save(db, [FOUND[1]]), []);
  });
  it('accepts a candidate found in the Nonprofits Registrar with that source', async () => {
    const inserted = await db.query<{ id: string }>(
      `insert into public.identifier_candidates (supplier_id, scheme, value, source,
        registrar_name, registrar_status, searched_name)
      values ($1, 'nonprofit', '580000008', 'nonprofits_registrar', 'ה (ע"ר)', 'רשומה', 'ספק')
      returning id`,
      [SUPPLIER],
    );
    const id = inserted.rows[0]?.id ?? '';
    await decide(db, USERS.admin, { id, accept: true });
    const added = await db.query<{ source: string; registrar_name: string }>(
      "select source, registrar_name from public.supplier_identifiers where value = '580000008'",
    );
    assert.deepEqual(added.rows, [{ source: 'nonprofits_registrar', registrar_name: 'ה (ע"ר)' }]);
  });
});
