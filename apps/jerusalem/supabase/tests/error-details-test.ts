// documentation/error-details-spec-he.md sections 3 and 6.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const ERROR = {
  name: 'error',
  error_code: 'unexpected',
  boundary: 'route',
  kind: 'system',
  screen: 'supplier-links',
  cause: 'superseded',
  request: 'catalog_snapshot',
  device: 'desktop',
  site_version: 'a1b2c3d',
};

interface Case {
  screen: string;
  cause: string;
  request: string | null;
  role: string | null;
  device: string | null;
  site_version: string | null;
}

describe('error details', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });
  const send = (events: unknown) =>
    db.query('select public.record_web_telemetry($1::jsonb)', [JSON.stringify(events)]);
  const cases = (days: number | null = 7) =>
    db.query<Case>('select * from public.error_cases($1)', [days]);

  it('records the cause, request, device and version, and reads the role in the database', async () => {
    await as(db, USERS.editor, async () => {
      await send([ERROR, { name: 'LCP', value: 100 }]);
    });
    await as(db, USERS.admin, async () => {
      const [row] = (await cases()).rows;
      assert.deepEqual(
        row && [row.screen, row.cause, row.request, row.role, row.device, row.site_version],
        ['supplier-links', 'superseded', 'catalog_snapshot', 'editor', 'desktop', 'a1b2c3d'],
      );
    });
    const vitals = await db.query<{ role: string | null }>(
      "select role from public.web_telemetry where name = 'LCP'",
    );
    assert.equal(vitals.rows[0]?.role, null, 'measurements carry no role');
  });

  it('never takes the role from the browser', async () => {
    await as(db, USERS.viewer, async () => {
      await assert.rejects(send([{ ...ERROR, role: 'admin' }]));
    });
  });

  it('rejects values outside the fixed lists and patterns', async () => {
    await as(db, USERS.admin, async () => {
      for (const item of [
        { ...ERROR, cause: 'oops' },
        { ...ERROR, request: 'select * from users' },
        { ...ERROR, request: 'Catalog' },
        { ...ERROR, screen: 'supplier/40000000' },
        { ...ERROR, screen: 'Supplier' },
        { ...ERROR, device: 'tablet' },
        { ...ERROR, site_version: 'main' },
        { ...ERROR, cause: 3 },
        { name: 'CLS', value: 0, cause: 'render' },
        { name: 'CLS', value: 0, device: 'mobile' },
      ])
        await assert.rejects(send([item]), /./, JSON.stringify(item));
    });
  });

  it('keeps older reports without the new fields readable', async () => {
    await as(db, USERS.admin, async () => {
      await send([{ name: 'error', error_code: 'http_5xx', boundary: 'action' }]);
      const [row] = (await cases()).rows;
      assert.deepEqual(row && [row.screen, row.cause, row.request], ['other', 'unknown', null]);
    });
  });

  it('shows the cases to administrators only, newest first, within the asked range', async () => {
    for (const user of [USERS.viewer, USERS.editor, USERS.manager, USERS.auditor])
      await as(db, user, async () => {
        await assert.rejects(cases(), { code: '42501' });
      });
    await db.query(
      "update public.web_telemetry set created_at = now() - interval '40 days' where screen = 'supplier-links'",
    );
    await as(db, USERS.admin, async () => {
      assert.equal((await cases(30)).rows.length, 1);
      assert.equal((await cases(null)).rows.length, 2);
      await assert.rejects(cases(0), { code: '22023' });
    });
  });
});
