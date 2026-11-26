import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  activeGrants,
  availableUnits,
  mayRevoke,
  parseGrant,
  noteError,
} from '../model/permissions.ts';
import { matchesPerson } from '../model/people.ts';
import type { Access } from '../../../data/access.ts';
const units = [
  { id: 'own', name: 'יחידה א' },
  { id: 'other', name: 'יחידה ב' },
];
const manager: Access = {
  state: 'active',
  member: true,
  admin: false,
  editor: true,
  manager: true,
  grants: [{ role: 'unit_manager', unitId: 'own' }],
};
it('limits a manager to viewer/editor grants in managed units', () => {
  const scope = { admin: false, units: availableUnits(units, manager) };
  assert.deepEqual(scope.units, [units[0]]);
  assert.equal(
    parseGrant({ target_user: 'user', wanted_role: 'editor', target_unit: 'own' }, scope).data
      ?.wanted_role,
    'editor',
  );
  assert.equal(
    parseGrant({ target_user: 'user', wanted_role: 'editor', target_unit: 'other' }, scope).data,
    null,
  );
  for (const wanted_role of ['admin', 'auditor', 'unit_manager', 'unknown'])
    assert.equal(
      parseGrant({ target_user: 'user', wanted_role, target_unit: 'own' }, scope).data,
      null,
    );
});
it('keeps global roles unitless and enforces a rejection reason', () => {
  const global = parseGrant(
    { target_user: 'user', wanted_role: 'admin', target_unit: 'stale' },
    { admin: true, units },
  );
  assert.equal(global.data?.target_unit, null);
  assert.notEqual(noteError('rejected', ' '), '');
  assert.equal(noteError('rejected', 'סיבה'), '');
  assert.equal(noteError('active', ''), '');
});
it('excludes revoked and expired grants at the exact expiry boundary', () => {
  const base = {
    id: 'g',
    user_id: 'user',
    role: 'viewer' as const,
    unit_id: 'own',
    revoked_at: null,
  };
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(activeGrants([{ ...base, expires_at: '2026-11-16T12:00:00Z' }], now).length, 0);
  assert.equal(activeGrants([{ ...base, expires_at: '2026-11-16T12:00:01Z' }], now).length, 1);
  assert.equal(
    activeGrants([{ ...base, expires_at: null, revoked_at: '2026-11-15T12:00:00Z' }], now).length,
    0,
  );
});
it('lets a manager remove only viewer and editor roles of their units', () => {
  assert.equal(mayRevoke({ role: 'editor', unit_id: 'own' }, manager), true);
  assert.equal(mayRevoke({ role: 'editor', unit_id: 'other' }, manager), false);
  assert.equal(mayRevoke({ role: 'unit_manager', unit_id: 'own' }, manager), false);
  assert.equal(mayRevoke({ role: 'admin', unit_id: null }, { ...manager, admin: true }), true);
});
it('finds people by every word of a name or email', () => {
  const person = { first_name: 'דנה', last_name: 'כהן', email: 'Dana@X.test' };
  assert.equal(matchesPerson(person, '  כהן   דנה '), true);
  assert.equal(matchesPerson(person, 'dana@x'), true);
  assert.equal(matchesPerson(person, 'לוי'), false);
  assert.equal(matchesPerson(person, ''), true);
});
