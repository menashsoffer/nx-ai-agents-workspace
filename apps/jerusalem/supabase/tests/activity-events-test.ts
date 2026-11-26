// RLS of public.activity_events: members log their own events; only admins and auditors read.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function log(db: PGlite, user: string | null, event: { actor: string; type?: string }) {
  return as(db, user, () =>
    errorCode(
      db.query('insert into public.activity_events (actor_id, event_type) values ($1, $2)', [
        event.actor,
        event.type ?? 'search',
      ]),
    ),
  );
}

describe('activity events', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => db.close());

  it('lets an active member log an event as themself', async () => {
    assert.equal(await log(db, USERS.viewer, { actor: USERS.viewer }), undefined);
    assert.equal(
      await log(db, USERS.editor, { actor: USERS.editor, type: 'page_view' }),
      undefined,
    );
  });

  it('refuses an event in another user name, from a non-member or from anon', async () => {
    assert.equal(await log(db, USERS.viewer, { actor: USERS.admin }), '42501');
    assert.equal(await log(db, USERS.pending, { actor: USERS.pending }), '42501');
    assert.equal(await log(db, USERS.blocked, { actor: USERS.blocked }), '42501');
    assert.equal(await log(db, null, { actor: USERS.viewer }), '42501');
  });

  it('refuses an unknown event type', async () => {
    assert.equal(await log(db, USERS.viewer, { actor: USERS.viewer, type: 'delete_all' }), '23514');
  });

  it('shows the log to admins and auditors only', async () => {
    const read = (user: string) =>
      as(db, user, () => count(db, 'select 1 from public.activity_events'));
    assert.equal(await read(USERS.admin), 2);
    assert.equal(await read(USERS.auditor), 2);
    assert.equal(await read(USERS.viewer), 0);
    assert.equal(await read(USERS.manager), 0);
  });

  it('never lets a signed-in user change or delete the log', async () => {
    const write = (sql: string) => as(db, USERS.admin, () => errorCode(db.query(sql)));
    assert.equal(await write("update public.activity_events set event_type = 'action'"), '42501');
    assert.equal(await write('delete from public.activity_events'), '42501');
  });
});
