import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Access, Role } from '../src/data/access.ts';
import { allowedScreens, audienceOf, mainRole } from '../src/app-shell/screens.ts';

function access(roles: Role[], state: Access['state'] = 'active'): Access {
  return {
    state,
    member: true,
    admin: roles.includes('admin'),
    editor: roles.includes('editor'),
    manager: roles.includes('unit_manager'),
    grants: roles.map((role) => ({ role, unitId: null })),
  };
}
const paths = (a: Access | null) => allowedScreens(a).map((s) => s.to);

describe('admin screens by role', () => {
  it('gives a viewer no admin screen, so the admin tab is hidden', () => {
    assert.deepEqual(paths(access(['viewer'])), []);
    assert.deepEqual(paths(null), []);
  });

  it('gives each role the screens its own checks allow', () => {
    assert.deepEqual(paths(access(['editor'])), ['/supplier/new']);
    assert.deepEqual(paths(access(['auditor'])), ['/load-control']);
    assert.ok(paths(access(['unit_manager'])).includes('/users'));
    assert.equal(paths(access(['admin'])).length, 12);
    assert.ok(paths(access(['unit_manager'])).includes('/registries'));
    assert.ok(paths(access(['admin'])).includes('/usage'));
    assert.ok(paths(access(['admin'])).includes('/import'));
    assert.ok(paths(access(['admin'])).includes('/errors'));
  });

  it('gives nothing to someone whose access is not active', () => {
    assert.deepEqual(paths(access(['admin'], 'blocked')), []);
  });

  it('names who a screen is for and the user role', () => {
    assert.equal(audienceOf('/users'), 'מנהל יחידה או מנהל מערכת');
    assert.equal(audienceOf('/identifiers'), 'מנהל מערכת');
    assert.equal(audienceOf('/thresholds'), 'מנהל מערכת');
    assert.equal(audienceOf('/import'), 'מנהל מערכת');
    assert.equal(audienceOf('/supplier-links'), 'מנהל מערכת');
    assert.equal(audienceOf('/errors'), 'מנהל מערכת');
    assert.equal(audienceOf('/registries'), 'מנהל יחידה או מנהל מערכת');
    assert.equal(audienceOf('/catalog'), null);
    assert.equal(mainRole(access(['viewer', 'editor'])), 'עורך');
    assert.equal(mainRole(access(['admin'])), 'מנהל מערכת');
    assert.equal(mainRole(access([], 'pending')), null);
    assert.equal(mainRole(access([])), null);
  });
});
