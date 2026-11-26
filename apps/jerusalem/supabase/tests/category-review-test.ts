import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';
describe('R8 category request decisions', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });
  async function request(user: string = USERS.viewer, name = 'תחום חדש') {
    return as(db, user, async () => {
      const result = await db.query<{ id: string }>(
        "insert into public.category_requests(proposed_name,description) values($1,'בקשת קטגוריה לדוגמה') returning id",
        [name],
      );
      return result.rows[0]?.id ?? '';
    });
  }
  it('refuses every non-admin role and anonymous access without changing the request', async () => {
    const id = await request();
    for (const actor of [
      null,
      USERS.viewer,
      USERS.editor,
      USERS.manager,
      USERS.auditor,
      USERS.pending,
      USERS.blocked,
      USERS.otherViewer,
    ]) {
      await as(db, actor, async () => {
        await assert.rejects(
          db.query("select public.decide_category_request($1,'approved','נדרש')", [id]),
        );
      });
    }
    const result = await db.query<{ status: string }>(
      'select status from public.category_requests where id=$1',
      [id],
    );
    assert.equal(result.rows[0]?.status, 'pending');
  });
  it('lets the only administrator approve and link their own request', async () => {
    const first = await request(USERS.admin, 'תחום של המנהל'),
      second = await request(USERS.admin);
    const category = await db.query<{ id: string }>(
      "insert into public.categories(name,description) values('קטגוריה לקישור','תיאור') returning id",
    );
    await as(db, USERS.admin, async () => {
      await db.query("select public.decide_category_request($1,'approved','נדרש')", [first]);
      await db.query("select public.decide_category_request($1,'linked','קישור',$2)", [
        second,
        category.rows[0]?.id,
      ]);
    });
    const result = await db.query<{ status: string }>(
      'select status from public.category_requests where id = any($1) order by status',
      [[first, second]],
    );
    assert.deepEqual(result.rows, [{ status: 'approved' }, { status: 'linked' }]);
  });
  it('allows a different administrator to approve and records the reviewer', async () => {
    const id = await request();
    await as(db, USERS.admin, async () => {
      await db.query("select public.decide_category_request($1,'approved','נדרש')", [id]);
    });
    const result = await db.query<{
      status: string;
      decided_by: string;
      resolved_category_id: string;
    }>('select status,decided_by,resolved_category_id from public.category_requests where id=$1', [
      id,
    ]);
    assert.equal(result.rows[0]?.status, 'approved');
    assert.equal(result.rows[0].decided_by, USERS.admin);
    assert.ok(result.rows[0].resolved_category_id);
  });
  it('requires an active link target and a reason for rejection, including own requests', async () => {
    const id = await request(),
      own = await request(USERS.admin);
    const category = await db.query<{ id: string }>(
      "insert into public.categories(name,description) values('קטגוריה קיימת','תיאור') returning id",
    );
    const target = category.rows[0]?.id ?? '';
    await as(db, USERS.admin, async () => {
      await assert.rejects(
        db.query("select public.decide_category_request($1,'linked','קישור')", [id]),
        /reason:choose_active_category/,
      );
      await assert.rejects(
        db.query("select public.decide_category_request($1,'rejected',' ')", [own]),
        /reason/i,
      );
      await db.query("select public.decide_category_request($1,'linked','קישור',$2)", [id, target]);
      await db.query("select public.decide_category_request($1,'rejected','לא נדרש')", [own]);
    });
    const result = await db.query<{ status: string; resolved_category_id: string }>(
      'select status,resolved_category_id from public.category_requests where id=$1',
      [id],
    );
    assert.deepEqual(result.rows, [{ status: 'linked', resolved_category_id: target }]);
  });

  it('reports an already decided request as missing, so the site can refresh', async () => {
    const id = await request();
    await as(db, USERS.admin, async () => {
      await db.query("select public.decide_category_request($1,'rejected','לא נדרש')", [id]);
      await assert.rejects(
        db.query("select public.decide_category_request($1,'rejected','שוב')", [id]),
        (error: unknown) => (error as { code?: string }).code === 'P0002',
      );
    });
  });

  it('needs a reason for every decision, approval and link included', async () => {
    const id = await request(USERS.viewer, 'תחום בלי נימוק');
    await as(db, USERS.admin, async () => {
      for (const note of [null, '', ' ']) {
        await assert.rejects(
          db.query("select public.decide_category_request($1,'approved',$2)", [id, note]),
          /category_requests_check/,
        );
      }
    });
    const result = await db.query<{ status: string }>(
      'select status from public.category_requests where id=$1',
      [id],
    );
    assert.equal(result.rows[0]?.status, 'pending');
  });
});
