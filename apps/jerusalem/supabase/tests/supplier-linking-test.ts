import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, USERS } from './access-fixture.ts';
import { OTHER_SUPPLIER, PEOPLE, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

// People who are not linked yet. MATCH's sign-in email is one OTHER_SUPPLIER already has.
const MATCH = '10000000-0000-0000-0000-0000000000b1';
const PROOF = '10000000-0000-0000-0000-0000000000b2';
const NAMELESS = '10000000-0000-0000-0000-0000000000b3';
const OTHER_NUMBER = '512345679';

type Row = Record<string, unknown>;

async function one(db: PGlite, sql: string, params: unknown[] = []): Promise<Row> {
  const { rows } = await db.query<{ v: Row }>(`select ${sql} as v`, params);
  return rows[0]?.v ?? {};
}

function link(db: PGlite, supplier: string, proof?: string): Promise<Row> {
  const request = JSON.stringify({ supplier_id: supplier, proof_path: proof });
  return one(db, 'public.portal_request_link($1::jsonb)', [request]);
}

function upload(db: PGlite, name: string): Promise<unknown> {
  return db.query(
    `insert into storage.objects (bucket_id, name) values
    ('supplier-documents', $1)`,
    [name],
  );
}

describe('linking a person to a supplier', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
    await db.exec(`insert into auth.users (id) values ('${MATCH}'), ('${PROOF}'), ('${NAMELESS}');
      insert into public.portal_people (user_id, first_name, last_name) values
        ('${MATCH}', 'נעם', 'בר'), ('${PROOF}', 'יעל', 'גל');
      insert into public.supplier_identifiers (supplier_id, scheme, value)
        values ('${OTHER_SUPPLIER}', 'company', '${OTHER_NUMBER}');
      insert into public.supplier_contacts (supplier_id, kind, value)
        values ('${OTHER_SUPPLIER}', 'email', '${MATCH.toUpperCase()}@Example.test')`);
  });
  after(async () => {
    await db.close();
  });

  it('describes a new person with no links', async () => {
    const me = await as(db, NAMELESS, () => one(db, 'public.portal_me()'));
    assert.deepEqual(me, {
      email: `${NAMELESS}@example.test`,
      person: null,
      accounts: [],
      invites: [],
    });
  });

  it('finds a supplier only by a full, valid number, and only its name', async () => {
    await as(db, MATCH, async () => {
      const found = await one(db, `public.portal_find_supplier('company', '${OTHER_NUMBER}')`);
      assert.deepEqual(found, { supplier_id: OTHER_SUPPLIER, name: 'ספק אחר' });
      await assert.rejects(
        one(db, `public.portal_find_supplier('company', '512345678')`),
        /identifier_invalid/,
      );
      await assert.rejects(
        one(db, `public.portal_find_supplier('personal_id', '${OTHER_NUMBER}')`),
        /identifier_invalid/,
      );
      const missing = await db.query(`select public.portal_find_supplier('nonprofit',
        '${OTHER_NUMBER}') as v`);
      assert.deepEqual(missing.rows, [{ v: null }]);
    });
  });

  it('asks for the person’s details before any link', async () => {
    await as(db, NAMELESS, async () => {
      await assert.rejects(link(db, OTHER_SUPPLIER), /person_required/);
    });
  });

  it('links at once when the sign-in email is one the supplier has', async () => {
    await as(db, MATCH, async () => {
      assert.equal((await link(db, OTHER_SUPPLIER)).status, 'active');
      await assert.rejects(link(db, OTHER_SUPPLIER), /already_linked/);
      const me = await one(db, 'public.portal_me()');
      const accounts = me.accounts as Row[];
      assert.equal(accounts[0]?.method, 'email_match');
      assert.equal((me.person as Row).first_name, 'נעם');
    });
  });

  it('needs the person’s own uploaded proof when the email does not match', async () => {
    await as(db, PROOF, async () => {
      await assert.rejects(link(db, SUPPLIER), /proof_required/);
      await assert.rejects(upload(db, `link-proofs/${MATCH}/x.pdf`), /row-level security/);
      await assert.rejects(link(db, SUPPLIER, `link-proofs/${MATCH}/x.pdf`), /proof_required/);
      await assert.rejects(link(db, SUPPLIER, `link-proofs/${PROOF}/none.pdf`), /proof_required/);
      await upload(db, `link-proofs/${PROOF}/extract.pdf`);
      const result = await link(db, SUPPLIER, `link-proofs/${PROOF}/extract.pdf`);
      assert.equal(result.status, 'pending');
      const own = await db.query('select name from storage.objects');
      assert.equal(own.rows.length, 1);
    });
  });

  it('refuses a supplier that is not active', async () => {
    await as(db, PROOF, async () => {
      await assert.rejects(
        link(db, '40000000-0000-0000-0000-0000000000ff'),
        /supplier_unavailable/,
      );
      await assert.rejects(link(db, 'not-a-uuid'), /supplier_unavailable/);
    });
  });

  it('shows the admin what waits and the recent email matches, and only the admin', async () => {
    const queue = await as(db, USERS.admin, async () => {
      assert.equal((await db.query('select name from storage.objects')).rows.length, 1);
      return db.query<{ v: Row[] }>('select public.supplier_link_queue() as v');
    });
    const rows = queue.rows[0]?.v ?? [];
    const seen = rows.map((r) => `${String(r.method)} ${String(r.status)} ${String(r.first_name)}`);
    assert.deepEqual(seen.toSorted(), [
      'document pending null',
      'document pending יעל',
      'email_match active דנה',
      'email_match active נעם',
    ]);
    await as(db, USERS.manager, async () => {
      await assert.rejects(db.query('select public.supplier_link_queue()'), /Not authorized/);
    });
  });

  it('lets only an admin decide, with a reason to reject, once', async () => {
    const pending = `(select id from public.supplier_accounts where user_id = '${PROOF}')`;
    await as(db, USERS.manager, async () => {
      await assert.rejects(
        db.query(`select public.decide_supplier_account(${pending}, true,
        null)`),
        /Not authorized/,
      );
    });
    await as(db, USERS.admin, async () => {
      await assert.rejects(
        db.query(`select public.decide_supplier_account(${pending}, false,
        '')`),
        /reason_required/,
      );
      await assert.rejects(
        db.query(`select public.decide_supplier_account(${pending}, null,
        null)`),
        /bad_choice/,
      );
      await db.query(`select public.decide_supplier_account(${pending}, true, null)`);
      await assert.rejects(
        db.query(`select public.decide_supplier_account(${pending}, true,
        null)`),
        /already_decided/,
      );
    });
    const ids = await as(db, PROOF, () => db.query('select private.my_supplier_ids() as id'));
    assert.deepEqual(ids.rows, [{ id: SUPPLIER }]);
  });

  it('rejects a waiting link with the reason the person sees', async () => {
    const waiting = `(select id from public.supplier_accounts where user_id = '${PEOPLE.waiting}')`;
    await as(db, USERS.admin, () =>
      db.query(`select public.decide_supplier_account(${waiting}, false, 'אין הוכחה')`),
    );
    const me = await as(db, PEOPLE.waiting, () => one(db, 'public.portal_me()'));
    assert.equal((me.accounts as Row[])[0]?.decision_note, 'אין הוכחה');
  });

  it('revokes a link at once, with a reason, and only once', async () => {
    const active = `(select id from public.supplier_accounts where user_id = '${MATCH}')`;
    await as(db, USERS.admin, async () => {
      await assert.rejects(
        db.query(`select public.revoke_supplier_account(${active}, ' ')`),
        /reason_required/,
      );
      await db.query(`select public.revoke_supplier_account(${active}, 'דוא"ל משותף')`);
      await assert.rejects(
        db.query(`select public.revoke_supplier_account(${active}, 'שוב')`),
        /already_decided/,
      );
    });
    await as(db, USERS.editor, async () => {
      await assert.rejects(
        db.query(`select public.revoke_supplier_account(${active}, 'x y')`),
        /Not authorized/,
      );
    });
    await as(db, MATCH, async () => {
      await assert.rejects(
        one(db, `public.portal_supplier('${OTHER_SUPPLIER}')`),
        /supplier_unavailable/,
      );
    });
  });

  it('stops after 10 attempts an hour', async () => {
    await as(db, NAMELESS, async () => {
      for (let i = 0; i < 10; i += 1) {
        await one(db, `public.portal_find_supplier('company', '${OTHER_NUMBER}')`);
      }
      await assert.rejects(
        one(db, `public.portal_find_supplier('company', '${OTHER_NUMBER}')`),
        /too_many_attempts/,
      );
      await assert.rejects(link(db, OTHER_SUPPLIER), /too_many_attempts/);
    });
  });

  it('refuses an anonymous sign-in', async () => {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: NAMELESS, role: 'authenticated', is_anonymous: true }),
    ]);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.portal_me()'), /sign_in_required/);
    await db.exec('reset role');
  });
});
