// Stage B (25.11): the nonprofit registrar's "נמחקה" counts as inactive, like the companies
// registrar's "מחוקה", so saving it marks the supplier for review.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { migratedDatabase } from './pglite.ts';

describe('registrar statuses', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
  });
  after(async () => {
    await db.close();
  });

  it('reads a deleted nonprofit as inactive and a registered one as active', async () => {
    const { rows } = await db.query<{ status: string; inactive: boolean }>(
      `select s as status, private.registry_inactive(s) as inactive
       from unnest(array['נמחקה', 'מחוקה', 'רשומה', 'פעילה']) s`,
    );
    assert.deepEqual(
      rows.map((r) => [r.status, r.inactive]),
      [
        ['נמחקה', true],
        ['מחוקה', true],
        ['רשומה', false],
        ['פעילה', false],
      ],
    );
  });
});
