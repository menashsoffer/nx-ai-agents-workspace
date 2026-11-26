import assert from 'node:assert/strict';
import { it } from 'node:test';
import { z } from 'zod';

import { DataError } from '../client.ts';
import { describeError, errorText } from '../errors.ts';
import { FAILURES, failureSentence, kindOfStatus } from '../../lib/errors/failure.ts';
import { setTelemetryReporter } from '../../lib/telemetry.ts';

it('gives every kind a cause, and a next step unless the cause says it all', () => {
  for (const [kind, text] of Object.entries(FAILURES)) {
    assert.ok(text.cause.endsWith('.'), kind);
    assert.ok(kind === 'reason' || text.next.length > 0, kind);
  }
});

it('offers "try again" only where it can help', () => {
  const retry = Object.entries(FAILURES)
    .filter(([, text]) => text.retry)
    .map(([kind]) => kind);
  assert.deepEqual(retry.sort(), ['offline', 'timeout', 'unavailable']);
});

it('keeps the text of a known failure and calls everything else a fault in the system', () => {
  assert.deepEqual(describeError(new DataError(403)), {
    kind: 'forbidden',
    text: new DataError(403).message,
    retry: false,
  });
  const badShape = z.object({ id: z.string() }).safeParse({}).error;
  assert.equal(describeError(badShape).kind, 'system');
  assert.equal(errorText(new Error('private detail')), failureSentence(FAILURES.system));
});

it('reads a fetch that got no answer as an unreachable server, not a bug', () => {
  assert.equal(describeError(new TypeError('Failed to fetch')).kind, 'unavailable');
  assert.equal(describeError(new DOMException('late', 'TimeoutError')).kind, 'timeout');
  assert.equal(describeError(new TypeError('x is not a function')).kind, 'system');
});

it('knows a dead database by its PostgREST code', () => {
  assert.equal(kindOfStatus(500, 'PGRST002'), 'unavailable');
  assert.equal(kindOfStatus(500, '42883'), 'system');
});

it('counts a shown error once, by kind, without its text', () => {
  const events: unknown[] = [];
  setTelemetryReporter(() => undefined); // drops the errors earlier tests showed
  setTelemetryReporter((event) => {
    events.push(event);
  });
  try {
    const error = new DataError(503);
    errorText(error);
    errorText(error);
    assert.deepEqual(events, [
      {
        name: 'error',
        error_code: 'http_5xx',
        boundary: 'action',
        kind: 'unavailable',
      },
    ]);
  } finally {
    setTelemetryReporter(() => undefined);
  }
});
