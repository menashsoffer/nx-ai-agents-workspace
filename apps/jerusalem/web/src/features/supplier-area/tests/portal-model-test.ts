import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PortalAccount, PortalMe } from '../api/portal.ts';
import {
  accountNote,
  activeAccounts,
  areaStep,
  proofProblem,
  proposalLabel,
  proposalProblem,
  readIdentifier,
  validity,
} from '../model/portal-model.ts';

const TYPES = ['application/pdf', 'image/png'];
const account = (over: Partial<PortalAccount>): PortalAccount => ({
  id: 'a',
  supplier_id: 's',
  supplier_name: 'ספק',
  role: 'owner',
  status: 'active',
  method: 'email_match',
  decision_note: null,
  created_at: '2026-11-22T08:00:00Z',
  ...over,
});
const me = (over: Partial<PortalMe>): PortalMe => ({
  email: 'a@b.co.il',
  person: { user_id: 'u', first_name: 'דנה', last_name: 'כהן', job_title: null, phone: null },
  accounts: [],
  invites: [],
  ...over,
});

describe('supplier area model', () => {
  it('reads a 9-digit company or nonprofit number with a valid check digit', () => {
    assert.deepEqual(readIdentifier(' 512-345-679 '), { scheme: 'company', value: '512345679' });
    assert.deepEqual(readIdentifier('580000021'), {
      error: 'המספר לא תקין. בדקו שאין ספרה שגויה.',
    });
    assert.deepEqual(readIdentifier('580000024'), { scheme: 'nonprofit', value: '580000024' });
    assert.match((readIdentifier('12345') as { error: string }).error, /9 הספרות/);
  });

  it('accepts a PDF or image of up to 10MB as proof', () => {
    assert.equal(proofProblem(null, TYPES, 10), 'יש לצרף קובץ.');
    assert.equal(
      proofProblem({ size: 5, type: 'text/plain' }, TYPES, 10),
      'אפשר לצרף רק PDF, JPEG או PNG.',
    );
    assert.match(proofProblem({ size: 11, type: 'image/png' }, TYPES, 10) ?? '', /10MB/);
    assert.equal(proofProblem({ size: 9, type: 'application/pdf' }, TYPES, 10), null);
  });

  it('opens on the person form, then the file, the invites, or the link wizard', () => {
    assert.equal(areaStep(me({ person: null })), 'person');
    assert.equal(areaStep(me({ accounts: [account({})] })), 'file');
    const invite = {
      id: 'i',
      supplier_name: 'ספק',
      role: 'owner' as const,
      expires_at: '2026-12-01',
    };
    assert.equal(areaStep(me({ invites: [invite] })), 'invites');
    assert.equal(areaStep(me({ accounts: [account({ status: 'pending' })] })), 'link');
    assert.equal(activeAccounts(me({ accounts: [account({ status: 'revoked' })] })).length, 0);
  });

  it('says what happened to a link that is not active, with the reason', () => {
    assert.equal(accountNote(account({ status: 'pending' })), 'הבקשה ממתינה לאישור העירייה.');
    assert.equal(
      accountNote(account({ status: 'rejected', decision_note: 'אין הוכחה' })),
      'הבקשה נדחתה. הסיבה: אין הוכחה',
    );
    assert.equal(accountNote(account({ status: 'revoked' })), 'השיוך בוטל בידי העירייה.');
    assert.equal(accountNote(account({})), '');
  });

  it('marks a registration that ends within 60 days', () => {
    assert.equal(validity(null, '2026-11-22'), 'open');
    assert.equal(validity('2026-11-01', '2026-11-22'), 'ended');
    assert.equal(validity('2027-01-21', '2026-11-22'), 'soon');
    assert.equal(validity('2027-01-22', '2026-11-22'), 'valid');
  });

  it('checks a fix with the database rules, and asks a reason only for a rename', () => {
    const fix = { kind: 'contact' as const, contact_kind: 'phone', value: '026291111', reason: '' };
    assert.equal(proposalProblem(fix), null);
    assert.match(proposalProblem({ ...fix, value: 'abc' }) ?? '', /טלפון/);
    assert.equal(proposalProblem({ ...fix, contact_kind: 'fax' }), 'יש לבחור אחת מהאפשרויות.');
    assert.match(proposalProblem({ ...fix, reason: 'א' }) ?? '', /סיבה/);
    const rename = { kind: 'rename' as const, value: 'ספק חדש', reason: '' };
    assert.match(proposalProblem(rename) ?? '', /סיבה/);
    assert.equal(proposalProblem({ ...rename, reason: 'שינוי ברשם' }), null);
    assert.equal(proposalLabel('rename', null), 'שם הספק');
    assert.equal(proposalLabel('entity_kind', null), 'סוג הספק');
    assert.equal(proposalLabel('contact', 'email'), 'דוא"ל');
    assert.equal(proposalLabel('contact', 'fax'), 'פרט קשר');
  });
});
