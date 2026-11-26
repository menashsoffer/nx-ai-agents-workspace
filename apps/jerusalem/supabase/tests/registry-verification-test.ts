import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, REGISTRY, SUPPLIER, UNIT_2, USERS, VERSION } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const FIELD = '30000000-0000-0000-0000-000000000003';
const SECOND = '40000000-0000-0000-0000-000000000002';
const THIRD = '40000000-0000-0000-0000-000000000003';
const MEMBER = ['60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002'];
const OTHER_REGISTRY = '30000000-0000-0000-0000-000000000004';
const OTHER_VERSION = '30000000-0000-0000-0000-000000000005';
const OTHER_MEMBER = '60000000-0000-0000-0000-000000000003';

interface Review {
  registry_id: string;
  valid_until: string | null;
  counts: { needs_review: number; verified: number; rejected: number; expired: number };
}

type Query = string | [string, unknown[]];

async function call<T>(db: PGlite, user: string, query: Query) {
  const [sql, params] = typeof query === 'string' ? [query, []] : query;
  return as(db, user, async () => (await db.query<{ value: T }>(sql, params)).rows[0]?.value);
}

const reviews = (db: PGlite, user: string) =>
  call<Review[]>(db, user, 'select public.registry_reviews() as value');

const decide = (db: PGlite, user: string, args: [string, boolean, string?]) =>
  call(db, user, [
    'select public.decide_membership($1, $2, $3) as value',
    [args[0], args[1], args[2] ?? null],
  ]);

async function enteredBy(db: PGlite, user: string): Promise<string> {
  const result = await as(db, user, () =>
    db.query<{ id: string }>(
      `insert into public.memberships (supplier_id, registry_version_id, source_page)
       values ($1, $2, 3) returning id`,
      [THIRD, VERSION],
    ),
  );
  return result.rows[0]?.id ?? '';
}

async function statuses(db: PGlite): Promise<Record<string, string>> {
  const result = await db.query<{ id: string; review_status: string; verified_by: string | null }>(
    `select id, review_status, verified_by from public.memberships order by id`,
  );
  return Object.fromEntries(result.rows.map((r) => [r.id, r.review_status]));
}

describe('registry verification', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`
      update public.registry_versions set valid_from = '2020-01-01' where id = '${VERSION}';
      insert into public.registries (id, name, owner_unit_id)
        values ('${OTHER_REGISTRY}', 'מאגר אחר', '${UNIT_2}');
      insert into public.registry_versions (id, registry_id) values
        ('${OTHER_VERSION}', '${OTHER_REGISTRY}');
      insert into public.registry_fields (id, registry_id, source_text) values
        ('${FIELD}', '${REGISTRY}', 'תכנון'),
        ('30000000-0000-0000-0000-000000000006', '${OTHER_REGISTRY}', 'תכנון');
      insert into public.suppliers (id, display_name) values ('${SECOND}', 'שני'),
        ('${THIRD}', 'שלישי');`);
  });
  beforeEach(async () => {
    await db.exec(`
      delete from public.memberships;
      update public.registry_versions set valid_until = null where id = '${VERSION}';
      insert into public.memberships (id, supplier_id, registry_version_id, registry_field_id,
        source_page) values
        ('${MEMBER[0] ?? ''}', '${SUPPLIER}', '${VERSION}', '${FIELD}', 1),
        ('${MEMBER[1] ?? ''}', '${SECOND}', '${VERSION}', '${FIELD}', 2),
        ('${OTHER_MEMBER}', '${THIRD}', '${OTHER_VERSION}',
          '30000000-0000-0000-0000-000000000006', 1);`);
  });
  after(async () => {
    await db.close();
  });

  it('lists only the registries the user manages, and nothing for staff without the role', async () => {
    const manager = await reviews(db, USERS.manager);
    assert.deepEqual(
      manager?.map((r) => r.registry_id),
      [REGISTRY],
    );
    assert.deepEqual(manager[0]?.counts, { needs_review: 2, verified: 0, rejected: 0, expired: 0 });
    assert.equal((await reviews(db, USERS.admin))?.length, 2);
    for (const user of [USERS.editor, USERS.viewer, USERS.auditor]) {
      await assert.rejects(reviews(db, user), /admin or a unit manager/);
    }
  });

  it('shows one registry with its members only to its reviewers', async () => {
    const sql = 'select public.registry_review($1) as value';
    const review = await call<{ members: { id: string }[] }>(db, USERS.manager, [sql, [VERSION]]);
    assert.deepEqual(
      review?.members.map((m) => m.id),
      MEMBER,
    );
    await assert.rejects(call(db, USERS.manager, [sql, [OTHER_VERSION]]), /Not permitted/);
    await assert.rejects(call(db, USERS.viewer, [sql, [VERSION]]), /Not permitted/);
  });

  it('sets the valid-until date, which members without their own date inherit', async () => {
    const sql = 'select public.set_registry_validity($1, $2) as value';
    await call(db, USERS.manager, [sql, [VERSION, '2020-12-31']]);
    const [row] = (await reviews(db, USERS.manager)) ?? [];
    assert.equal(row?.valid_until, '2020-12-31');
    assert.equal(row.counts.expired, 2);
    await assert.rejects(call(db, USERS.manager, [sql, [VERSION, '2019-01-01']]), /before/);
    await assert.rejects(call(db, USERS.editor, [sql, [VERSION, '2030-01-01']]), /Not permitted/);
    await assert.rejects(call(db, USERS.manager, [sql, [OTHER_VERSION, null]]), /Not permitted/);
  });

  it('verifies one supplier at a time, and rejects only with a reason', async () => {
    const [first = '', second = ''] = MEMBER;
    await decide(db, USERS.manager, [first, true]);
    await assert.rejects(decide(db, USERS.manager, [second, false]), /reason/);
    await assert.rejects(decide(db, USERS.manager, [second, false, ' ']), /reason/);
    await decide(db, USERS.manager, [second, false, 'לא מופיע במסמך']);
    const rows = await db.query<{ review_status: string; verified_by: string; note: string }>(
      `select review_status, verified_by, note from public.memberships order by id`,
    );
    assert.deepEqual(
      rows.rows.map((r) => [r.review_status, r.verified_by, r.note]),
      [
        ['verified', USERS.manager, null],
        ['rejected', null, 'לא מופיע במסמך'],
        ['needs_review', null, null],
      ],
    );
    assert.deepEqual((await reviews(db, USERS.manager))?.[0]?.counts, {
      needs_review: 0,
      verified: 1,
      rejected: 1,
      expired: 0,
    });
  });

  it('refuses another unit, staff without the role, and changes nothing', async () => {
    const before = await statuses(db);
    await assert.rejects(decide(db, USERS.manager, [OTHER_MEMBER, true]), /Not permitted/);
    await assert.rejects(decide(db, USERS.editor, [MEMBER[0] ?? '', true]), /Not permitted/);
    await assert.rejects(decide(db, USERS.viewer, [MEMBER[0] ?? '', true]), /Not permitted/);
    assert.deepEqual(await statuses(db), before);
  });

  it('keeps the rule that a unit manager does not verify a row they entered', async () => {
    const own = await enteredBy(db, USERS.manager);
    await assert.rejects(decide(db, USERS.manager, [own, true]), /self_verification/);
  });

  it('lets the only admin verify a row they loaded, until a second admin exists', async () => {
    const own = await enteredBy(db, USERS.admin);
    await decide(db, USERS.admin, [own, true]);
    await decide(db, USERS.admin, [own, false, 'בדיקה חוזרת']);
    await db.exec(
      `insert into public.role_grants (user_id, role) values ('${USERS.editor}', 'admin')`,
    );
    try {
      await assert.rejects(decide(db, USERS.admin, [own, true]), /self_verification/);
    } finally {
      await db.exec(
        `delete from public.role_grants where user_id = '${USERS.editor}' and role = 'admin'`,
      );
    }
  });

  it('keeps the rule for the only admin on other tables', async () => {
    const supplier = await as(db, USERS.admin, () =>
      db.query<{ id: string }>(
        `insert into public.suppliers (display_name) values ('חדש') returning id`,
      ),
    );
    await assert.rejects(
      as(db, USERS.admin, () =>
        db.query(`update public.suppliers set review_status = 'verified' where id = $1`, [
          supplier.rows[0]?.id,
        ]),
      ),
      /self_verification/,
    );
  });
});
