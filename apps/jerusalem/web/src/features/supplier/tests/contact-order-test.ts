import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  contactGroup,
  contactIcon,
  contactLabel,
  isMobile,
  sortContacts,
  splitPhones,
} from '../model/contact-order.ts';

describe('contact order', () => {
  it('tells a mobile from a landline', () => {
    assert.equal(isMobile('054-2244973'), true);
    assert.equal(isMobile('+972-54-2244973'), true);
    assert.equal(isMobile('03-6872787'), false);
    assert.equal(isMobile('1-800-123-456'), false);
    assert.equal(contactGroup('phone', '050 123 4567'), 'mobile');
    assert.equal(contactGroup('pager', 'x'), 'other');
    assert.equal(contactLabel('phone', '052-1234567'), 'טלפון נייד');
    assert.equal(contactLabel('phone', '02-6297777'), 'טלפון');
    assert.equal(contactLabel('pager', 'x'), 'פרט קשר');
    assert.equal(contactIcon('phone', '052-1234567'), 'mobile');
    assert.equal(contactIcon('email', 'a@b.test'), 'mail');
  });

  it('sorts email, address, phones, mobiles, then the rest, keeping order inside a group', () => {
    const list = [
      { kind: 'contact_person', value: 'דנה' },
      { kind: 'phone', value: '054-1111111' },
      { kind: 'pager', value: 'x' },
      { kind: 'phone', value: '03-1111111' },
      { kind: 'address', value: 'יפו 1' },
      { kind: 'phone', value: '02-2222222' },
      { kind: 'email', value: 'a@b.test' },
      { kind: 'website', value: 'x.test' },
    ];
    assert.deepEqual(
      sortContacts(list).map((item) => item.value),
      ['a@b.test', 'יפו 1', '03-1111111', '02-2222222', '054-1111111', 'x.test', 'דנה', 'x'],
    );
  });

  it('splits a value that holds several numbers, and only then', () => {
    assert.deepEqual(splitPhones('054-2244973 054-5990250'), ['054-2244973', '054-5990250']);
    assert.deepEqual(splitPhones('02-6297777, 054-5990250'), ['02-6297777', '054-5990250']);
    assert.deepEqual(splitPhones('02 629 7777'), ['02 629 7777']);
    assert.deepEqual(splitPhones('054-2244973 שלוחה 5'), ['054-2244973 שלוחה 5']);
    assert.deepEqual(splitPhones('054-2244973'), ['054-2244973']);
  });
});
