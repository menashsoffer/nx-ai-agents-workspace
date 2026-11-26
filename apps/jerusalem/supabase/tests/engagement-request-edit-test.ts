import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, UNIT_1, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const DRAFT = { estimated_value: 120000, value_includes_vat: false, requested_exemption: null };
const EDITED = {
  subject: 'ייעוץ ארגוני מעודכן',
  estimated_value: 90000,
  value_includes_vat: true,
  requested_exemption: '3(8)',
};

async function failure(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return 'none';
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return message.startsWith('invalid:') ? message : String(code);
  }
}

function call(db: PGlite, user: string, query: { sql: string; args: unknown[] }) {
  return as(db, user, async () => {
    await db.query(query.sql, query.args);
  });
}

describe('editing and cancelling an engagement request', () => {
  let db: PGlite;
  let request = '';
  const edit = (user: string, draft: unknown = EDITED) =>
    call(db, user, {
      sql: 'select public.update_engagement_request($1, $2::jsonb)',
      args: [request, JSON.stringify(draft)],
    });
  const cancel = (user: string, note: string | null) =>
    call(db, user, {
      sql: 'select public.cancel_engagement_request($1, $2)',
      args: [request, note],
    });
  const row = async () =>
    (
      await db.query<Record<string, unknown>>(
        'select subject, estimated_value::float as value, value_includes_vat, ' +
          'requested_exemption, status, cancel_note from public.engagement_requests where id = $1',
        [request],
      )
    ).rows[0];

  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    request = await as(db, USERS.editor, async () => {
      const draft = { ...DRAFT, unit_id: UNIT_1, subject: 'ייעוץ ארגוני' };
      const result = await db.query<{ id: string }>(
        'select public.create_engagement_request($1::jsonb) as id',
        [JSON.stringify(draft)],
      );
      return result.rows[0]?.id ?? '';
    });
  });
  after(async () => {
    await db.close();
  });

  it('lets an editor of the unit change the details', async () => {
    assert.equal(await failure(edit(USERS.editor)), 'none');
    assert.deepEqual(await row(), {
      subject: EDITED.subject,
      value: 90000,
      value_includes_vat: true,
      requested_exemption: '3(8)',
      status: 'draft',
      cancel_note: null,
    });
  });

  it('refuses viewers, other units and broken details', async () => {
    assert.equal(await failure(edit(USERS.viewer)), '42501');
    assert.equal(await failure(edit(USERS.auditor)), '42501');
    assert.equal(await failure(edit(USERS.otherViewer)), 'P0002');
    assert.equal(
      await failure(edit(USERS.editor, { ...EDITED, subject: '12' })),
      'invalid:too_short',
    );
    assert.equal(
      await failure(edit(USERS.editor, { ...EDITED, requested_exemption: '9' })),
      'invalid:bad_exemption',
    );
    assert.equal((await row())?.subject, EDITED.subject);
  });

  it('cancels only with a reason and only by an editor or manager', async () => {
    assert.equal(await failure(cancel(USERS.editor, null)), 'invalid:required');
    assert.equal(await failure(cancel(USERS.editor, '  ')), 'invalid:required');
    assert.equal(await failure(cancel(USERS.viewer, 'לא רלוונטי')), '42501');
    assert.equal(await failure(cancel(USERS.manager, 'הצורך בוטל')), 'none');
    const cancelled = await row();
    assert.equal(cancelled?.status, 'cancelled');
    assert.equal(cancelled.cancel_note, 'הצורך בוטל');
  });

  it('keeps a cancelled request closed', async () => {
    assert.equal(await failure(edit(USERS.editor)), 'invalid:request_closed');
    assert.equal(await failure(cancel(USERS.editor, 'שוב')), 'invalid:request_closed');
  });

  it('lets a manager cancel an approved request but not edit it', async () => {
    await db.exec(
      `update public.engagement_requests set status = 'approved' where id = '${request}'`,
    );
    assert.equal(await failure(edit(USERS.manager)), 'invalid:request_closed');
    assert.equal(await failure(cancel(USERS.editor, 'החוזה לא נחתם')), 'none');
  });
});
