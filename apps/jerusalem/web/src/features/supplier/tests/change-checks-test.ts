import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Check, SupplierChange } from '../../../data/supplier-changes.ts';
import {
  changeLabel,
  changeValue,
  checkText,
  overall,
  reasonNeeded,
  sameChanges,
  waitsForDecision,
  type CheckedChange,
} from '../model/change-checks.ts';

const change = (kind: SupplierChange['kind'], contactKind?: string): SupplierChange => ({
  supplier_id: 's',
  kind,
  value: 'v',
  ...(contactKind ? { contact_kind: contactKind } : {}),
});
const checked = (item: SupplierChange, outcome: Check['outcome']): CheckedChange => ({
  change: item,
  result: { outcome, checks: [{ check: 'x', outcome }] },
});

describe('supplier change checks in the edit dialog', () => {
  it('writes every check as one Hebrew sentence', () => {
    const texts: [Check, RegExp][] = [
      [{ check: 'name_rule', outcome: 'red', problem: 'no_change' }, /זהה לערך הנוכחי/],
      [{ check: 'name_rule', outcome: 'red', problem: 'too_short' }, /קצר מדי/],
      [{ check: 'kind_rule', outcome: 'red', problem: 'mystery' }, /הערך לא תקין/],
      [{ check: 'other_supplier', outcome: 'red', name: 'אלון' }, /ספק פעיל בשם הזה: אלון/],
      [{ check: 'other_supplier', outcome: 'yellow', name: 'אלון' }, /דומה מאוד לספק אחר/],
      [{ check: 'registrar_name', outcome: 'green' }, /זהה לשם ברשם/],
      [{ check: 'registrar_name', outcome: 'yellow', name: 'א בע"מ' }, /ברשם: א בע"מ/],
      [{ check: 'no_registry', outcome: 'yellow' }, /אין מרשם פתוח/],
      [{ check: 'registry_status', outcome: 'green', name: 'פעילה' }, /במצב: פעילה/],
      [{ check: 'registry_status', outcome: 'yellow', name: 'מחוקה' }, /מחוקה. אפשר לשמור עם סיבה/],
      [{ check: 'change_size', outcome: 'green' }, /כתיב קטן/],
      [{ check: 'change_size', outcome: 'yellow' }, /השתנה לגמרי/],
      [{ check: 'identifier_kind', outcome: 'green' }, /מתאים למספר המזהה/],
      [{ check: 'identifier_kind', outcome: 'yellow', problem: 'no_identifier' }, /אין לספק/],
      [{ check: 'identifier_kind', outcome: 'yellow' }, /שממתין לבדיקה/],
      [{ check: 'identifier_kind', outcome: 'red' }, /סותר את המספר המאומת/],
      [{ check: 'name_kind', outcome: 'green' }, /מתאים לשם/],
      [{ check: 'name_kind', outcome: 'yellow' }, /לא מתאים לשם/],
      [{ check: 'contact_rule', outcome: 'green' }, /הפרט תקין/],
      [{ check: 'contact_rule', outcome: 'red', problem: 'contact_missing' }, /כבר הוחלף/],
      [{ check: 'shared_contact', outcome: 'yellow', name: 'אלון' }, /רשום גם אצל אלון/],
      [{ check: 'shared_contact', outcome: 'yellow' }, /רשום גם אצל ספק אחר/],
      [{ check: 'later_check', outcome: 'yellow' }, /צריך אישור/],
      [{ check: 'later_check', outcome: 'green' }, /הבדיקה עברה/],
      [{ check: 'later_check', outcome: 'red' }, /הבדיקה לא עברה/],
      [{ check: 'other_supplier', outcome: 'green' }, /הבדיקה עברה/],
    ];
    for (const [check, text] of texts) assert.match(checkText(check), text, check.check);
  });

  it('names a change and its value in the words of the dialog', () => {
    assert.equal(changeLabel('rename'), 'שם הספק');
    assert.equal(changeLabel('entity_kind'), 'סוג ישות');
    assert.equal(changeLabel('contact', 'phone'), 'טלפון');
    assert.equal(changeLabel('contact', null), 'פרט קשר');
    assert.equal(changeValue('entity_kind', 'cooperative'), 'אגודה שיתופית');
    assert.equal(changeValue('entity_kind', 'odd'), 'odd');
    assert.equal(changeValue('contact', null), '—');
    assert.equal(changeValue('rename', 'שם'), 'שם');
  });

  it('asks for a reason and a decision as section 5 of the spec says', () => {
    const greenContact = [checked(change('contact', 'phone'), 'green')];
    const yellowContact = [checked(change('contact', 'phone'), 'yellow')];
    const greenRename = [checked(change('rename'), 'green')];
    const yellowKind = [checked(change('entity_kind'), 'yellow')];
    assert.equal(reasonNeeded(greenContact, false), false);
    assert.equal(reasonNeeded(yellowContact, false), false);
    assert.equal(reasonNeeded(yellowContact, true), true);
    assert.equal(reasonNeeded(greenRename, false), true);
    assert.equal(reasonNeeded(yellowKind, false), true);
    assert.equal(waitsForDecision(yellowKind, false), true);
    assert.equal(waitsForDecision(yellowKind, true), false);
    assert.equal(overall([...greenContact, ...yellowKind]), 'yellow');
    assert.equal(overall([...yellowKind, checked(change('rename'), 'red')]), 'red');
    assert.equal(overall(greenContact), 'green');
  });

  it('treats two lists as the same request only when nothing in them differs', () => {
    assert.equal(sameChanges([change('rename')], [change('rename')]), true);
    assert.equal(sameChanges([change('rename')], [{ ...change('rename'), value: 'w' }]), false);
  });
});
