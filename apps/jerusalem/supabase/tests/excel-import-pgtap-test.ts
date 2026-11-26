import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgtap } from '@electric-sql/pglite-pgtap';

import { applyMigrations, SUPABASE_STUB } from './pglite.ts';

it('runs the Excel import pgTAP acceptance checks', async () => {
  const db = new PGlite({ extensions: { pg_trgm, pgtap } });
  try {
    await db.exec(SUPABASE_STUB);
    await applyMigrations(db);
    const sql = await readFile(new URL('./excel_import.test.sql', import.meta.url), 'utf8');
    const result = await db.exec(sql);
    const lines = result.flatMap((statement) =>
      statement.rows.flatMap((row) =>
        Object.values(row).filter((value) => typeof value === 'string'),
      ),
    );
    const plan = lines.find((line) => /^1\.\.\d+$/.test(line));
    assert.ok(plan, 'pgTAP did not return a plan');
    assert.deepEqual(
      lines.filter((line) => line.startsWith('not ok')),
      [],
    );
    assert.equal(lines.filter((line) => /^ok \d+/.test(line)).length, Number(plan.slice(3)));
    assert.equal(
      lines.some((line) => line.includes('Looks like you failed')),
      false,
    );
  } finally {
    await db.close();
  }
});
