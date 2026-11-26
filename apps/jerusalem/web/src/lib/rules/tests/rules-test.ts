import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RULES } from '../catalog.ts';
import { validCheckDigit } from '../israeli-id.ts';
import { databaseRuleMessage, RULE_MESSAGES } from '../messages.ts';
import { check, contactForm, membershipForm, statusForm } from '../forms.ts';
import { RULE_CASES } from './rule-cases.ts';

describe('value rules', () => {
  for (const [rule, value, expected] of RULE_CASES) {
    it(`${rule}: ${JSON.stringify(value).slice(0, 40)} -> ${String(expected)}`, () => {
      const problem = RULES[rule];
      assert.ok(problem, `unknown rule ${rule}`);
      assert.equal(problem(value), expected);
    });
  }
  it('checks Israeli check digits', () => {
    assert.equal(validCheckDigit('512679903'), true);
    assert.equal(validCheckDigit('000000018'), true);
    assert.equal(validCheckDigit('123'), false);
  });
});

const MEMBERSHIP = {
  display_name: 'ספק חדש',
  entity_kind: 'company',
  identifier_scheme: 'company',
  identifier: '512679903',
  registered_from: '2024-01-01',
  registered_until: '2026-12-31',
  engagement_started_on: '',
  phone: '02-6297777',
  email: '',
};

describe('form schemas', () => {
  it('checks a contact by its kind and cleans spaces', () => {
    assert.deepEqual(check(contactForm, { kind: 'phone', value: ' 02-6297777 ' }), {
      ok: true,
      value: { kind: 'phone', value: '02-6297777' },
    });
    assert.deepEqual(check(contactForm, { kind: 'email', value: 'שטויות' }), {
      ok: false,
      errors: { value: RULE_MESSAGES.bad_email },
    });
    assert.equal(check(contactForm, { kind: 'fax', value: '1' }).ok, false);
  });
  it('requires a reason and a past date to mark a supplier inactive', () => {
    const schema = statusForm('2026-11-17');
    const good = check(schema, { reason: 'החברה פורקה', source: '', changed_on: '2026-11-01' });
    assert.deepEqual(good, {
      ok: true,
      value: { reason: 'החברה פורקה', source: null, changed_on: '2026-11-01' },
    });
    const bad = check(schema, { reason: 'x', source: '', changed_on: '2027-01-01' });
    assert.deepEqual(bad, {
      ok: false,
      errors: { reason: RULE_MESSAGES.too_short, changed_on: RULE_MESSAGES.date_future },
    });
  });
  it('checks the new supplier form, identifier pair and date order', () => {
    assert.equal(check(membershipForm, MEMBERSHIP).ok, true);
    const pair = check(membershipForm, { ...MEMBERSHIP, identifier: '' });
    assert.deepEqual(pair, { ok: false, errors: { identifier: RULE_MESSAGES.identifier_pair } });
    const order = check(membershipForm, { ...MEMBERSHIP, registered_until: '2023-01-01' });
    assert.deepEqual(order, {
      ok: false,
      errors: { registered_until: RULE_MESSAGES.dates_order },
    });
    const junk = check(membershipForm, { ...MEMBERSHIP, phone: 'שטויות', email: 'x' });
    assert.deepEqual(Object.keys(junk.ok ? {} : junk.errors), ['phone', 'email']);
  });
  it('reads database rule errors', () => {
    assert.equal(databaseRuleMessage('invalid:bad_phone'), RULE_MESSAGES.bad_phone);
    assert.equal(databaseRuleMessage('Supplier is unavailable'), null);
  });
});
