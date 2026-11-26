import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecision } from '../model/decision.ts';
function form(decision: string, note = '', category = '') {
  const data = new FormData();
  data.set('decision', decision);
  data.set('note', note);
  data.set('category_id', category);
  return data;
}
describe('category decision input', () => {
  it('requires a meaningful reason for every decision, and a link destination', () => {
    assert.deepEqual(parseDecision(form('rejected', ' ')), { field: 'note', error: 'שדה חובה.' });
    assert.deepEqual(parseDecision(form('approved', '')), { field: 'note', error: 'שדה חובה.' });
    assert.deepEqual(parseDecision(form('maybe', 'x')), {
      field: 'decision',
      error: 'יש לבחור החלטה.',
    });
    assert.match((parseDecision(form('approved', '!!')) as { error: string }).error, /מילים/);
    assert.deepEqual(parseDecision(form('linked', 'כפילות')), {
      field: 'category_id',
      error: 'יש לבחור קטגוריה קיימת לקישור.',
    });
  });
  it('sends no category target when approving or rejecting', () => {
    assert.deepEqual(parseDecision(form('approved', ' נדרש ', 'irrelevant')), {
      decision: 'approved',
      note: 'נדרש',
      category_id: null,
    });
    assert.deepEqual(parseDecision(form('linked', 'כפילות', 'chosen')), {
      decision: 'linked',
      note: 'כפילות',
      category_id: 'chosen',
    });
  });
});
