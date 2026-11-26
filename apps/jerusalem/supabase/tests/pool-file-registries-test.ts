import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

interface Report {
  created: number;
  linked: number;
  ambiguous: number;
  memberships: number;
  fields: number;
  registry_id: string;
}

function row(key: string, names: string[], extra: Record<string, unknown> = {}) {
  return { key, name: names[0], names, published_name: names[0], field: 'תחום א', ...extra };
}

const POOL_A = {
  name: 'מאגר חדש',
  note: 'נטען מקובץ המאגר המאוחד',
  url: 'https://www.jerusalem.muni.il/media/x/pool.pdf',
  file_name: 'pool.pdf',
  rows: [
    // Matches the existing supplier by name; its number is already known.
    row('SUP-1', ['ספק בע"מ'], {
      phones: ['02-1234567'],
      emails: ['A@Example.com'],
      scheme: 'company',
      value: '512345678',
    }),
    // No supplier has this name, so a new one is created with its details.
    row('SUP-2', ['חדש', 'חדש בע"מ'], {
      address: 'רחוב 1',
      person: 'דנה',
      scheme: 'company',
      value: '515301596',
      page: 3,
    }),
    // Two active suppliers have this name: the row waits for a person.
    row('SUP-3', ['כפול']),
    // Same file key as the second row, under another field and name.
    row('SUP-2', ['חדש אחר'], { field: 'תחום ב' }),
  ],
};

const POOL_B = {
  name: 'מאגר ישן',
  status: 'closed',
  url: 'https://www.jerusalem.muni.il/media/y/old.pdf',
  rows: [row('SUP-2', ['שם שונה לגמרי'])],
};

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function load(db: PGlite, user: string, file: unknown): Promise<Report | undefined> {
  return as(db, user, async () => {
    const result = await db.query<{ report: Report }>(
      'select public.import_pool_registry($1) as report',
      [JSON.stringify(file)],
    );
    return result.rows[0]?.report;
  });
}

describe('registries from a pool file', () => {
  let db: PGlite;
  let created = '';
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.suppliers (display_name) values ('כפול'), ('כפול בע"מ')`);
  });
  after(async () => {
    await db.close();
  });

  it('lets only an administrator load a registry', async () => {
    assert.equal(await errorCode(load(db, USERS.editor, POOL_A)), '42501');
    assert.equal(await errorCode(load(db, USERS.manager, POOL_A)), '42501');
    assert.equal(await count(db, "select 1 from public.registries where name = 'מאגר חדש'"), 0);
  });

  it('links, creates and holds back rows, with one field per source text', async () => {
    const report = await load(db, USERS.admin, POOL_A);
    assert.deepEqual(
      { ...report, registry_id: undefined },
      { created: 1, linked: 2, ambiguous: 1, memberships: 3, fields: 2, registry_id: undefined },
    );
    const members = await db.query<{ display_name: string; review_status: string }>(
      `select s.display_name, m.review_status from public.memberships m
       join public.suppliers s on s.id = m.supplier_id
       join public.registry_versions v on v.id = m.registry_version_id
       where v.registry_id = $1 order by s.display_name`,
      [report?.registry_id],
    );
    assert.deepEqual(
      members.rows.map((m) => m.review_status),
      ['needs_review', 'needs_review', 'needs_review'],
    );
    const fresh = await db.query<{ id: string; review_status: string }>(
      "select id, review_status from public.suppliers where display_name = 'חדש'",
    );
    created = fresh.rows[0]?.id ?? '';
    assert.equal(fresh.rows[0]?.review_status, 'needs_review');
  });

  it('adds contacts and names once, and the number only as a pending candidate', async () => {
    const contacts = await db.query<{ kind: string; normalized_value: string }>(
      `select kind, normalized_value from public.supplier_contacts
       where supplier_id in ($1, $2) order by kind`,
      [SUPPLIER, created],
    );
    assert.deepEqual(contacts.rows, [
      { kind: 'address', normalized_value: 'רחוב 1' },
      { kind: 'contact_person', normalized_value: 'דנה' },
      { kind: 'email', normalized_value: 'a@example.com' },
      { kind: 'phone', normalized_value: '021234567' },
    ]);
    const names = await count(
      db,
      `select 1 from public.supplier_names where supplier_id = '${created}'`,
    );
    assert.equal(names, 2);
    const candidates = await db.query<{ supplier_id: string; value: string; status: string }>(
      'select supplier_id, value, status from public.identifier_candidates',
    );
    assert.deepEqual(candidates.rows, [
      { supplier_id: created, value: '515301596', status: 'pending' },
    ]);
  });

  it('keeps an ambiguous row pending with a note for the reviewer', async () => {
    const pending = await db.query<{ status: string; reviewer_note: string | null }>(
      "select status, reviewer_note from public.import_rows where raw ->> 'key' = 'SUP-3'",
    );
    const [staged] = pending.rows;
    assert.ok(staged);
    assert.equal(staged.status, 'pending');
    assert.match(staged.reviewer_note ?? '', /יותר מספק אחד/);
  });

  it('reuses the supplier of the same file key in another registry', async () => {
    const report = await load(db, USERS.admin, POOL_B);
    assert.ok(report);
    assert.equal(report.linked, 1);
    assert.equal(report.created, 0);
    const status = await db.query<{ status: string }>(
      "select status from public.registries where name = 'מאגר ישן'",
    );
    assert.equal(status.rows[0]?.status, 'closed');
    const sql = `select 1 from public.memberships where supplier_id = '${created}'`;
    assert.equal(await count(db, sql), 3);
  });

  it('refuses to load a registry that already exists', async () => {
    assert.equal(await errorCode(load(db, USERS.admin, POOL_A)), '23505');
    assert.equal(await count(db, "select 1 from public.registries where name = 'מאגר חדש'"), 1);
  });
});
