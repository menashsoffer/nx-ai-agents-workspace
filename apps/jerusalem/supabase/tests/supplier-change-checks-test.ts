// The automatic checks of supplier-edit-checks-spec-he.md sections 4.1, 4.3 and 4.4.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';
import {
  BARE,
  CHANGE_FIXTURE,
  NEIGHBOUR,
  PHONE,
  RETIRED,
  TRADER,
  VERIFIED,
  checkChange,
  failure,
  outcomeOf,
} from './supplier-change-fixture.ts';

describe('supplier change checks', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(CHANGE_FIXTURE);
  });
  after(async () => db.close());

  const check = (change: Parameters<typeof checkChange>[1]) =>
    as(db, USERS.editor, () => checkChange(db, change));

  it('refuses a bad, unchanged or duplicate name', async () => {
    const short = await check({ supplier_id: SUPPLIER, kind: 'rename', value: 'א' });
    assert.equal(short.outcome, 'red');
    assert.equal(short.checks[0]?.problem, 'too_short');
    const same = await check({ supplier_id: SUPPLIER, kind: 'rename', value: 'ספק' });
    assert.equal(same.checks[0]?.problem, 'no_change');
    const taken = await check({ supplier_id: SUPPLIER, kind: 'rename', value: 'דנה כהן ייעוץ' });
    assert.equal(outcomeOf(taken, 'other_supplier'), 'red');
  });

  it('warns about a similar supplier and a name that changed completely', async () => {
    const similar = await check({
      supplier_id: SUPPLIER,
      kind: 'rename',
      value: 'אורבן תכנון ובינויי',
    });
    assert.equal(outcomeOf(similar, 'other_supplier'), 'yellow');
    assert.equal(similar.outcome, 'yellow');
    const spelling = await check({ supplier_id: SUPPLIER, kind: 'rename', value: 'ספקים' });
    assert.equal(spelling.outcome, 'green');
    const changed = await check({ supplier_id: SUPPLIER, kind: 'rename', value: 'שם אחר לגמרי' });
    assert.equal(outcomeOf(changed, 'change_size'), 'yellow');
  });

  it('compares a name with the registrar name of the supplier', async () => {
    const registrar = await check({
      supplier_id: VERIFIED,
      kind: 'rename',
      value: 'חברת הנדסה ירושלמית בע"מ',
    });
    assert.equal(registrar.outcome, 'green');
    assert.equal(outcomeOf(registrar, 'change_size'), undefined);
    const other = await check({ supplier_id: VERIFIED, kind: 'rename', value: 'הנדסה ירושלים' });
    assert.equal(outcomeOf(other, 'registrar_name'), 'yellow');
    const trader = await check({ supplier_id: TRADER, kind: 'rename', value: 'דנה כהן יעוץ' });
    assert.equal(outcomeOf(trader, 'no_registry'), 'yellow');
  });

  it('checks an entity kind against the identifier and the name', async () => {
    const conflict = await check({
      supplier_id: VERIFIED,
      kind: 'entity_kind',
      value: 'nonprofit',
    });
    assert.equal(conflict.outcome, 'red');
    const body = await check({ supplier_id: VERIFIED, kind: 'entity_kind', value: 'public_body' });
    assert.equal(body.outcome, 'green');
    const pending = await check({ supplier_id: SUPPLIER, kind: 'entity_kind', value: 'nonprofit' });
    assert.equal(pending.outcome, 'yellow');
    assert.equal(
      (await check({ supplier_id: SUPPLIER, kind: 'entity_kind', value: 'company' })).outcome,
      'green',
    );
    const named = await check({ supplier_id: BARE, kind: 'entity_kind', value: 'company' });
    assert.equal(outcomeOf(named, 'name_kind'), 'green');
    assert.equal(outcomeOf(named, 'identifier_kind'), 'yellow');
    const wrong = await check({ supplier_id: BARE, kind: 'entity_kind', value: 'cooperative' });
    assert.equal(outcomeOf(wrong, 'name_kind'), 'yellow');
    const unknown = await check({ supplier_id: SUPPLIER, kind: 'entity_kind', value: 'person' });
    assert.equal(unknown.checks[0]?.problem, 'bad_choice');
    const same = await check({ supplier_id: VERIFIED, kind: 'entity_kind', value: 'company' });
    assert.equal(same.checks[0]?.problem, 'no_change');
  });

  it('reads two different kinds in one name as a conflict', async () => {
    const hint = await db.query<{ value: string | null }>(
      `select private.kind_hint('עמותת הסעות בע"מ') as value`,
    );
    assert.equal(hint.rows[0]?.value, 'conflict');
    const edits = await db.query<{ near: boolean; far: boolean }>(
      `select private.within_edits('abcdef', 'abXdeg', 3) as near,
        private.within_edits('abc', 'abcdefg', 3) as far`,
    );
    assert.deepEqual(edits.rows[0], { near: true, far: false });
  });

  it('checks a contact for format, repetition and another supplier with it', async () => {
    const contact = (value: string, kind = 'phone', contactId?: string) =>
      check({
        supplier_id: SUPPLIER,
        kind: 'contact',
        contact_kind: kind,
        value,
        ...(contactId ? { contact_id: contactId } : {}),
      });
    assert.equal((await contact('12')).checks[0]?.problem, 'bad_phone');
    assert.equal((await contact('026291111')).checks[0]?.problem, 'no_change');
    assert.equal((await contact('a@b.co', 'fax')).checks[0]?.problem, 'bad_choice');
    const missing = await contact('026291112', 'phone', NEIGHBOUR);
    assert.equal(missing.checks[0]?.problem, 'contact_missing');
    const shared = await contact('Office@Urban.example', 'email');
    assert.equal(outcomeOf(shared, 'shared_contact'), 'yellow');
    assert.equal((await contact('026291112', 'phone', PHONE)).outcome, 'green');
  });

  it('lets only editors check, and only active suppliers', async () => {
    const input = { supplier_id: SUPPLIER, kind: 'rename' as const, value: 'ספק חדש' };
    assert.match(await as(db, USERS.viewer, () => failure(checkChange(db, input))), /^42501/);
    assert.match(await as(db, null, () => failure(checkChange(db, input))), /^42501/);
    assert.match(
      await failure(check({ ...input, supplier_id: RETIRED })),
      /reason:supplier_inactive/,
    );
    const absent = { ...input, supplier_id: '41000000-0000-0000-0000-0000000000ff' };
    assert.match(await failure(check(absent)), /reason:supplier_unavailable/);
    const extra = { ...input, note: 'x' } as unknown as typeof input;
    assert.match(await failure(check(extra)), /^22023/);
  });
});
