import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, USERS } from './access-fixture.ts';
import { OTHER_SUPPLIER, PEOPLE, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

type Row = Record<string, unknown>;

async function one(db: PGlite, sql: string, params: unknown[] = []): Promise<Row> {
  const { rows } = await db.query<{ v: Row }>(`select ${sql} as v`, params);
  return rows[0]?.v ?? {};
}

const upload = (db: PGlite, name: string) =>
  db.query("insert into storage.objects (bucket_id, name) values ('supplier-documents', $1)", [
    name,
  ]);

const save = (db: PGlite, document: Row) =>
  one(db, 'public.portal_save_document($1::jsonb)', [
    JSON.stringify({ supplier_id: SUPPLIER, kind: 'insurance', ...document }),
  ]);

interface Decision {
  id: unknown;
  approve: boolean;
  note?: string;
  until?: string;
}
const decide = (db: PGlite, { id, approve, note, until }: Decision) =>
  db.query('select public.decide_supplier_document($1, $2, $3, $4)', [
    id,
    approve,
    note ?? null,
    until ?? null,
  ]);

const statuses = async (db: PGlite) =>
  (
    await db.query<{ storage_path: string; status: string; valid_until: string }>(
      `select storage_path, status, valid_until::text from public.supplier_documents
       order by created_at, storage_path`,
    )
  ).rows;

describe('supplier documents', () => {
  let db: PGlite;
  const future = '2027-06-30';
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('asks a company for three kinds and a nonprofit also for proper management', async () => {
    const own = await as(db, PEOPLE.owner, () => one(db, `public.portal_documents('${SUPPLIER}')`));
    assert.deepEqual(own, {
      kinds: ['bookkeeping', 'tax_withholding', 'insurance'],
      documents: [],
    });
    await db.exec(`update public.suppliers set entity_kind = 'nonprofit'
      where id = '${OTHER_SUPPLIER}'`);
    const other = await as(db, PEOPLE.otherOwner, () =>
      one(db, `public.portal_documents('${OTHER_SUPPLIER}')`),
    );
    assert.deepEqual(other.kinds, [
      'bookkeeping',
      'tax_withholding',
      'insurance',
      'proper_management',
    ]);
    await as(db, PEOPLE.otherOwner, () =>
      assert.rejects(one(db, `public.portal_documents('${SUPPLIER}')`), /supplier_unavailable/),
    );
  });

  it('takes files only under a supplier the person is linked to', async () => {
    await as(db, PEOPLE.owner, () => upload(db, `${SUPPLIER}/a.pdf`));
    await as(db, PEOPLE.owner, () =>
      assert.rejects(upload(db, `${OTHER_SUPPLIER}/x.pdf`), /row-level security/),
    );
    await as(db, PEOPLE.waiting, () =>
      assert.rejects(upload(db, `${SUPPLIER}/w.pdf`), /row-level security/),
    );
    const seen = await as(db, PEOPLE.otherOwner, () =>
      db.query('select name from storage.objects'),
    );
    assert.equal(seen.rows.length, 0, 'another supplier does not see the file');
  });

  it('records an uploaded file, with a real date and a kind asked of the supplier', async () => {
    await as(db, PEOPLE.owner, async () => {
      await assert.rejects(
        save(db, { storage_path: `${SUPPLIER}/none.pdf`, valid_until: future }),
        /file_required/,
      );
      const path = `${SUPPLIER}/a.pdf`;
      await assert.rejects(
        save(db, { storage_path: path, valid_until: '2020-01-01' }),
        /date_invalid/,
      );
      await assert.rejects(
        save(db, { storage_path: path, valid_until: '2027-02-30' }),
        /date_invalid/,
      );
      await assert.rejects(
        save(db, { storage_path: path, valid_until: future, kind: 'proper_management' }),
        /bad_choice/,
      );
      const saved = await save(db, { storage_path: path, valid_until: future });
      assert.equal(saved.status, 'pending');
      await upload(db, `${SUPPLIER}/b.pdf`);
      await save(db, { storage_path: `${SUPPLIER}/b.pdf`, valid_until: future });
    });
    assert.deepEqual(
      (await statuses(db)).map((r) => r.status),
      ['replaced', 'pending'],
      'a second upload of the kind replaces the waiting one',
    );
  });

  it('hides the table from suppliers and shows it to staff', async () => {
    const supplier = await as(db, PEOPLE.owner, () =>
      db.query('select * from public.supplier_documents'),
    );
    assert.equal(supplier.rows.length, 0);
    const staff = await as(db, USERS.viewer, () =>
      db.query('select * from public.supplier_documents'),
    );
    assert.equal(staff.rows.length, 2);
  });

  it('lets only an admin list and decide, with a reason to reject', async () => {
    await as(db, USERS.editor, () =>
      assert.rejects(one(db, 'public.supplier_document_queue()'), /Not authorized/),
    );
    const queue = await as(db, USERS.admin, () =>
      db.query<{ v: Row[] }>('select public.supplier_document_queue() as v'),
    );
    const [waiting = {}] = queue.rows[0]?.v ?? [];
    assert.equal(waiting.supplier_name, 'ספק');
    const overview = await as(db, USERS.admin, () => one(db, 'public.admin_overview()'));
    assert.equal(overview.supplier_links_pending, 3, 'two links to check and one document');
    await as(db, USERS.admin, async () => {
      await assert.rejects(
        decide(db, { id: waiting.id, approve: false, note: ' ' }),
        /reason_required/,
      );
      await decide(db, { id: waiting.id, approve: true, until: '2027-12-31' });
      await assert.rejects(decide(db, { id: waiting.id, approve: true }), /already_decided/);
    });
    const [, approved] = await statuses(db);
    assert.deepEqual(approved, {
      storage_path: `${SUPPLIER}/b.pdf`,
      status: 'approved',
      valid_until: '2027-12-31',
    });
  });

  it('replaces the approved document when a newer one is approved, and shows a rejection', async () => {
    await as(db, PEOPLE.owner, async () => {
      await upload(db, `${SUPPLIER}/c.pdf`);
      await save(db, { storage_path: `${SUPPLIER}/c.pdf`, valid_until: future });
      await upload(db, `${SUPPLIER}/d.pdf`);
      await save(db, {
        storage_path: `${SUPPLIER}/d.pdf`,
        valid_until: future,
        kind: 'bookkeeping',
      });
    });
    const ids = await db.query<{ id: string; storage_path: string }>(
      "select id, storage_path from public.supplier_documents where status = 'pending'",
    );
    const id = (name: string) => ids.rows.find((r) => r.storage_path.endsWith(name))?.id;
    await as(db, USERS.admin, async () => {
      await decide(db, { id: id('c.pdf'), approve: true });
      await decide(db, { id: id('d.pdf'), approve: false, note: 'הקובץ לא קריא' });
    });
    const shown = await as(db, PEOPLE.owner, () =>
      one(db, `public.portal_documents('${SUPPLIER}')`),
    );
    const documents = shown.documents as Row[];
    assert.deepEqual(
      documents.map((d) => [d.kind, d.status, d.review_note]),
      [
        ['bookkeeping', 'rejected', 'הקובץ לא קריא'],
        ['insurance', 'approved', null],
      ],
    );
  });
});
