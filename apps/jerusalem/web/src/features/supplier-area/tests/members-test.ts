import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { areaLink, type Member, type Members } from '../api/members.ts';
import { canRemove, inviteProblem, memberName } from '../model/members.ts';

const member = (over: Partial<Member> = {}): Member => ({
  id: 'a1',
  first_name: 'דנה',
  last_name: 'כהן',
  job_title: null,
  email: 'dana@example.co.il',
  role: 'owner',
  method: 'email_match',
  created_at: '2026-11-22T08:00:00Z',
  is_me: true,
  ...over,
});
const list = (...members: Member[]): Members => ({ members, invites: [] });

describe('our people', () => {
  it('asks for a full address that is not linked yet', () => {
    const people = list(member());
    assert.match(inviteProblem('dana', people), /כתובת דוא"ל מלאה/);
    assert.match(inviteProblem('a@b', people), /כתובת דוא"ל מלאה/);
    assert.match(inviteProblem(' DANA@example.co.il ', people), /כבר משויך/);
    assert.equal(inviteProblem('noa@example.co.il', people), '');
  });

  it('never lets the last owner go', () => {
    const owner = member();
    const worker = member({ id: 'a2', role: 'member', is_me: false });
    assert.equal(canRemove(owner, list(owner, worker)), false);
    assert.equal(canRemove(worker, list(owner, worker)), true);
    const second = member({ id: 'a3', is_me: false });
    assert.equal(canRemove(owner, list(owner, second)), true);
  });

  it('names a person by name, then email', () => {
    assert.equal(memberName(member()), 'דנה כהן');
    assert.equal(memberName(member({ first_name: null, last_name: null })), 'dana@example.co.il');
    assert.equal(memberName(member({ first_name: null, last_name: null, email: null })), 'בלי שם');
  });

  it('links to the supplier area of this site', () => {
    assert.equal(
      areaLink({ origin: 'https://x.test', pathname: '/admin.html' }),
      'https://x.test/admin.html#/supplier-area',
    );
  });
});
