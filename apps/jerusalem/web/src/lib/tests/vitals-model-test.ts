import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createVitalsModel, errorCode } from '../vitals-model.ts';
describe('anonymous Core Web Vitals', () => {
  it('keeps the latest LCP and ignores invalid readings', () => {
    const model = createVitalsModel();
    model.lcp(1500);
    model.lcp(1200);
    model.lcp(NaN);
    model.lcp(-1);
    assert.deepEqual(
      model.reports().find((v) => v.name === 'LCP'),
      { name: 'LCP', value: 1500, bounded: false },
    );
  });
  it('uses CLS session windows and excludes shifts following input', () => {
    const model = createVitalsModel();
    model.shift(100, 0.04, false);
    model.shift(900, 0.03, false);
    model.shift(950, 0.9, true);
    model.shift(1900, 0.09, false);
    assert.equal(model.reports().find((v) => v.name === 'CLS')?.value, 0.09);
  });
  it('starts the five-second window at the first shift, not document time zero', () => {
    const model = createVitalsModel();
    for (let i = 0; i < 6; i++) model.shift(100 + i * 900, 0.01, false);
    model.shift(5090, 0.01, false);
    model.shift(5100, 0.02, false);
    assert.equal(model.reports().find((v) => v.name === 'CLS')?.value, 0.07);
  });
  it('groups an interaction and drops one outlier per fifty interactions', () => {
    const model = createVitalsModel();
    model.interaction(1, 600);
    model.interaction(1, 200);
    model.interaction(2, 180);
    model.interaction(0, 9000);
    assert.deepEqual(
      model.reports(49).find((v) => v.name === 'INP'),
      { name: 'INP', value: 600, bounded: false },
    );
    assert.deepEqual(
      model.reports(50).find((v) => v.name === 'INP'),
      { name: 'INP', value: 180, bounded: false },
    );
  });
  it('labels conservative fallback bounds rather than claiming unsupported precision', () => {
    const model = createVitalsModel();
    assert.equal(
      model.reports(0).some((v) => v.name === 'INP'),
      false,
    );
    assert.deepEqual(
      model.reports(1).find((v) => v.name === 'INP'),
      { name: 'INP', value: 16, bounded: true },
    );
    model.interaction(1, 180);
    assert.deepEqual(
      model.reports().find((v) => v.name === 'INP'),
      { name: 'INP', value: 180, bounded: true },
    );
  });
  it('serializes only numeric readings and fixed error codes', () => {
    const privateError = {
      status: 403,
      get message() {
        throw Error('must not read');
      },
      stack: 'token secret@example.test /supplier/id',
    };
    assert.equal(errorCode(privateError), 'http_403');
    assert.equal(errorCode(new Error('secret')), 'unexpected');
    assert.equal(
      errorCode({
        get status() {
          throw Error('getter');
        },
      }),
      'unexpected',
    );
    const model = createVitalsModel();
    model.lcp(50);
    assert.deepEqual(Object.keys(model.reports()[0] ?? {}).sort(), ['bounded', 'name', 'value']);
  });
  it('keeps only the ten slowest interactions and ignores invalid ones', () => {
    const model = createVitalsModel();
    model.interaction(0, 500);
    model.interaction(1.5, 500);
    model.interaction(1, -1);
    model.interaction(1, Number.NaN);
    for (let id = 1; id <= 12; id += 1) model.interaction(id, id * 10);
    model.interaction(12, 50);
    assert.deepEqual(
      model.reports(600).find((v) => v.name === 'INP'),
      { name: 'INP', value: 30, bounded: true },
    );
    assert.deepEqual(
      model.reports(0).find((v) => v.name === 'INP'),
      { name: 'INP', value: 120, bounded: false },
    );
  });
  it('labels a rank past few recorded interactions as a bound', () => {
    const model = createVitalsModel();
    model.interaction(1, 40);
    assert.deepEqual(
      model.reports(100).find((v) => v.name === 'INP'),
      { name: 'INP', value: 16, bounded: true },
    );
  });
  it('maps server errors to fixed codes', () => {
    assert.equal(errorCode({ status: 503 }), 'http_5xx');
    assert.equal(errorCode({ status: 404 }), 'http_404');
    assert.equal(errorCode({ status: 600 }), 'unexpected');
    assert.equal(errorCode({ status: '500' }), 'unexpected');
    assert.equal(errorCode(null), 'unexpected');
  });
});
