import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, REGISTRY, USERS } from './access-fixture.ts';
import { applyMigrations, as, count, migratedDatabase } from './pglite.ts';

const FIELD = '50000000-0000-0000-0000-000000000001';
const FIRST = '60000000-0000-0000-0000-000000000001';
const SECOND = '60000000-0000-0000-0000-000000000002';
const HIDDEN = '60000000-0000-0000-0000-000000000003';
const PREVIOUS = '20261113010000_threshold_calculator.sql';
const TABLE = 'public.registry_field_categories';

describe('source field category links', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase({ until: PREVIOUS });
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.categories (id, name, active) values
      ('${FIRST}', 'חשמל', true), ('${SECOND}', 'בטיחות', true), ('${HIDDEN}', 'ישן', false);
      insert into public.registry_fields (id, registry_id, source_text, category_id)
      values ('${FIELD}', '${REGISTRY}', 'חשמל ובטיחות', '${FIRST}')`);
    await applyMigrations(db, { after: PREVIOUS });
  });
  after(async () => db.close());

  it('copies a legacy category and allows multiple links without duplicates', async () => {
    assert.equal(await count(db, `select 1 from ${TABLE} where category_id = '${FIRST}'`), 1);
    await as(db, USERS.admin, async () => {
      await db.exec(`insert into ${TABLE} (registry_field_id, category_id)
        values ('${FIELD}', '${SECOND}')`);
      await assert.rejects(
        db.exec(`insert into ${TABLE} (registry_field_id, category_id)
          values ('${FIELD}', '${SECOND}')`),
        /duplicate key/,
      );
    });
    assert.equal(await count(db, `select 1 from ${TABLE}`), 2);
  });

  it('permits only admins to write, and hides inactive categories from ordinary members', async () => {
    await as(db, USERS.admin, async () => {
      await db.exec(`insert into ${TABLE} (registry_field_id, category_id)
        values ('${FIELD}', '${HIDDEN}')`);
    });
    for (const user of [USERS.viewer, USERS.editor, USERS.manager]) {
      await as(db, user, async () => {
        assert.equal(await count(db, `select 1 from ${TABLE}`), 2);
        await assert.rejects(
          db.exec(`insert into ${TABLE} (registry_field_id, category_id)
            values ('${FIELD}', '${HIDDEN}')`),
          /row-level security/,
        );
        await db.exec(`delete from ${TABLE} where category_id = '${SECOND}'`);
        assert.equal(await count(db, `select 1 from ${TABLE}`), 2);
      });
    }
    for (const user of [USERS.pending, USERS.blocked]) {
      await as(db, user, async () => {
        assert.equal(await count(db, `select 1 from ${TABLE}`), 0);
      });
    }
    await as(db, USERS.auditor, async () => {
      assert.equal(await count(db, `select 1 from ${TABLE}`), 3);
    });
    await as(db, null, async () =>
      assert.rejects(db.exec(`select * from ${TABLE}`), /permission denied/),
    );
  });

  it('keeps legacy changes synchronized and guards against deleting the legacy link', async () => {
    await as(db, USERS.admin, async () => {
      await assert.rejects(
        db.exec(
          `delete from ${TABLE} where registry_field_id = '${FIELD}' and category_id = '${FIRST}'`,
        ),
        /Clear the legacy category/,
      );
      await db.exec(
        `update public.registry_fields set category_id = '${SECOND}' where id = '${FIELD}'`,
      );
      assert.equal(await count(db, `select 1 from ${TABLE} where category_id = '${FIRST}'`), 0);
      assert.equal(await count(db, `select 1 from ${TABLE} where category_id = '${SECOND}'`), 1);
      await db.exec(`update public.registry_fields set category_id = null where id = '${FIELD}'`);
      assert.equal(await count(db, `select 1 from ${TABLE} where category_id = '${SECOND}'`), 0);
    });
  });
});
