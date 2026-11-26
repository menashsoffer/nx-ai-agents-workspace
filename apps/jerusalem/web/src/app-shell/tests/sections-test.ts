import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { Access } from '../../data/access.ts';
import { sectionOf, visibleSections } from '../sections.ts';

it('keeps the catalog tab selected on supplier screens', () => {
  assert.equal(sectionOf('/catalog'), 'catalog');
  assert.equal(sectionOf('/supplier/new'), 'catalog');
  assert.equal(sectionOf('/supplier/8f1c'), 'catalog');
});

it('groups the engagement request and the route check under requests', () => {
  assert.equal(sectionOf('/engagement'), 'requests');
  assert.equal(sectionOf('/route-check'), 'requests');
});

it('puts every admin screen under admin', () => {
  for (const path of ['/admin', '/categories', '/identifiers', '/users', '/thresholds']) {
    assert.equal(sectionOf(path), 'admin', path);
  }
  assert.equal(sectionOf('/load-control'), 'admin');
});

it('selects no tab on sign-in or unknown paths, and does not match on a shared prefix', () => {
  assert.equal(sectionOf('/auth'), null);
  assert.equal(sectionOf('/no-such-screen'), null);
  assert.equal(sectionOf('/catalogue'), null);
});

it('selects the home tab only on the home screen', () => {
  assert.equal(sectionOf('/'), 'home');
  assert.equal(sectionOf('/home'), null);
});

const keys = (access: Access | null, admin = false) =>
  visibleSections(access, admin).map((section) => section.key);
const person = (state: Access['state'], member: boolean): Access => ({
  state,
  member,
  admin: false,
  editor: false,
  manager: false,
  grants: [],
});

it('shows the home tab only to active staff, whose home it is', () => {
  assert.deepEqual(keys(null), ['catalog', 'requests']);
  assert.deepEqual(keys(person('pending', false)), ['catalog', 'requests']);
  assert.deepEqual(keys(person('active', false)), ['catalog', 'requests']);
  assert.deepEqual(keys(person('active', true)), ['home', 'catalog', 'requests']);
  assert.deepEqual(keys(person('active', true), true), ['home', 'catalog', 'requests', 'admin']);
});
