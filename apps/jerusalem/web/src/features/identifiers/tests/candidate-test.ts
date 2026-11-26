import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nameHint, candidateSchema, evidenceHint } from '../model/candidate.ts';
import { diffWords, listCandidates, matchLevel } from '../model/match.ts';
describe('identifier evidence', () => {
  it('never treats an exact textual match as proof', () => {
    assert.match(nameHint('יועצי העיר בע״מ', 'יועצי העיר בע"מ'), /רמז בלבד/);
    assert.match(nameHint('ספק א', 'ספק ב'), /אינו הוכחה/);
    assert.match(nameHint('ספק א', null), /ידנית/);
  });
  it('refuses unsupported sources and malformed identifiers', () => {
    const row = {
      id: 'c',
      supplier_id: 's',
      scheme: 'company',
      value: '512345678',
      source: 'companies_registrar',
      registrar_name: null,
      registrar_status: null,
      searched_name: 'א',
      found_at: '2026-11-16',
    };
    assert.equal(candidateSchema.safeParse(row).success, true);
    assert.equal(candidateSchema.safeParse({ ...row, value: '<script>' }).success, false);
    assert.equal(candidateSchema.safeParse({ ...row, source: 'untrusted' }).success, false);
    const nonprofit = { ...row, scheme: 'nonprofit', source: 'nonprofits_registrar' };
    assert.equal(candidateSchema.safeParse(nonprofit).success, true);
  });
  it('asks for a registrar check on a number taken from a pool file', () => {
    const row = candidateSchema.parse({
      id: 'c',
      supplier_id: 's',
      scheme: 'personal_id',
      value: '012345678',
      source: 'pool_file',
      registrar_name: null,
      registrar_status: null,
      searched_name: 'ספק א',
      found_at: '2026-11-17',
    });
    assert.match(evidenceHint(row, 'ספק א'), /לפי השם בלבד/);
    assert.match(evidenceHint({ ...row, source: 'guidestar' }, 'ספק א'), /ידנית/);
  });
});
describe('name match', () => {
  it('ignores legal suffixes and punctuation, then compares words', () => {
    assert.equal(matchLevel('יועצי העיר בע"מ', 'יועצי העיר'), 'same');
    assert.equal(matchLevel('יועצי העיר', 'יועצי העיר והסביבה'), 'similar');
    assert.equal(matchLevel('יועצי העיר', 'בונים'), 'different');
    assert.equal(matchLevel('יועצי העיר', null), 'different');
  });
  it('marks only the words our name does not have', () => {
    assert.deepEqual(
      diffWords('יועצי העיר החדשה', 'יועצי העיר').map((part) => part.differs),
      [false, false, false, false, true],
    );
  });
  it('lists closest names first and filters by source and words', () => {
    const base = candidateSchema.parse({
      id: 'c',
      supplier_id: 's',
      scheme: 'company',
      value: '512345678',
      source: 'companies_registrar',
      registrar_name: null,
      registrar_status: null,
      searched_name: 'א',
      found_at: '2026-11-16',
    });
    const rows = [
      { candidate: base, supplier: 'ב', level: 'different' as const },
      {
        candidate: { ...base, source: 'guidestar' as const },
        supplier: 'א',
        level: 'same' as const,
      },
    ];
    const all = listCandidates(rows, { source: '', query: '' });
    assert.deepEqual(
      all.map((row) => row.supplier),
      ['א', 'ב'],
    );
    assert.equal(listCandidates(rows, { source: 'guidestar', query: '' }).length, 1);
    assert.equal(listCandidates(rows, { source: '', query: 'ב' }).length, 1);
  });
});
