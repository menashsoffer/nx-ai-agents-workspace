import assert from 'node:assert/strict';
import { it } from 'node:test';
import { EventBatcher } from '../src/lib/tracker.ts';
import type { TelemetryEvent } from '../src/lib/vitals-model.ts';
import { eventRpcRequest } from '../src/data/site.ts';
it('reuses batching for identifier-free telemetry and tolerates missing authorization', () => {
  const sent: RequestInit[] = [];
  const win = {
    addEventListener: () => undefined,
    fetch: (_url: string, init: RequestInit) => {
      sent.push(init);
      return Promise.resolve(new Response());
    },
  } as unknown as Window;
  let authorized = false;
  const batcher = new EventBatcher<TelemetryEvent>(win, (events) =>
    authorized ? eventRpcRequest('record_web_telemetry', 'authorization-only', events) : null,
  );
  batcher.add({ name: 'CLS', value: 0.05, bounded: false });
  batcher.flush();
  assert.equal(sent.length, 0);
  authorized = true;
  batcher.add({ name: 'error', error_code: 'unexpected', boundary: 'route' });
  batcher.flush();
  assert.equal(sent.length, 1);
  const request = sent[0];
  assert.ok(request);
  assert.equal(request.keepalive, true);
  const body = request.body;
  assert.ok(typeof body === 'string');
  assert.deepEqual(JSON.parse(body), {
    events: [{ name: 'error', error_code: 'unexpected', boundary: 'route' }],
  });
  assert.doesNotMatch(body, /authorization|actor|user|session|url|message|stack/);
});
it('does not let request-building failures interfere with recovery', () => {
  const win = {
    addEventListener: () => undefined,
    fetch: () => Promise.resolve(new Response()),
  } as unknown as Window;
  const batcher = new EventBatcher<TelemetryEvent>(win, () => {
    throw Error('unavailable');
  });
  assert.doesNotThrow(() => {
    batcher.add({ name: 'LCP', value: 1, bounded: false });
    batcher.flush();
  });
});
