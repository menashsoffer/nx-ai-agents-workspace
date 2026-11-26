// Each Edge Function registers its handler with Deno.serve when it runs in the Edge Runtime.
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { requests, served } from './deno-stub.ts';
import '../address-check/index.ts';
import '../registry-recheck/index.ts';
import '../route-check/index.ts';
import '../supplier-change-check/index.ts';
import '../supplier-identifiers/index.ts';
import '../threshold-index/index.ts';

it('registers one handler per function, started with the Edge Runtime settings', async () => {
  assert.equal(served.length, 6);
  const statuses = [];
  for (const handler of served) {
    const response = await handler(new Request('https://fn.test', { method: 'POST', body: '{}' }));
    statuses.push(response.status);
  }
  // The caller-facing functions refuse a request without a token; the scheduled jobs reach
  // the stubbed database and report it as unavailable.
  assert.deepEqual(statuses, [502, 502, 401, 401, 401, 502]);
  assert.deepEqual(requests, [
    'https://db.test/rest/v1/rpc/job_start',
    'https://db.test/rest/v1/rpc/job_start',
    'https://db.test/rest/v1/rpc/job_start',
  ]);
});
