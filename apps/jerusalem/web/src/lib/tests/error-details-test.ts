// error-details-spec-he.md sections 3 and 6.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { causeOf, withDetails } from '../error-details.ts';
import { kindLabel } from '../errors/kind-labels.ts';
import { reportBoundaryError, setTelemetryReporter, tagRequest } from '../telemetry.ts';
import type { ErrorReport, TelemetryEvent } from '../vitals-model.ts';

/** The shape of the site's DataError, which lib code may not import. */
function failure(status: number, kind: string, extra: object = {}): Error {
  return Object.assign(new Error('x'), { status, kind }, extra);
}
const CONTEXT = { screen: 'supplier-links', device: 'desktop', version: 'a1b2c3d' } as const;
const EVENT: ErrorReport = { name: 'error', error_code: 'unexpected', boundary: 'route' };

describe('what an error was', () => {
  it('names each cause from a fixed list, in order', () => {
    const zod = z.string().safeParse(3).error;
    const cases: [unknown, string][] = [
      [failure(0, 'system', { superseded: true }), 'superseded'],
      [new TypeError('Failed to fetch dynamically imported module: /x.js'), 'stale_files'],
      [new TypeError('Importing a module script failed.'), 'stale_files'],
      [failure(422, 'rule'), 'rule'],
      [failure(503, 'unavailable'), 'http'],
      [failure(0, 'offline'), 'network'],
      [failure(0, 'unconfirmed'), 'network'],
      [failure(0, 'system'), 'bad_answer'],
      [zod, 'bad_answer'],
      [new TypeError("Cannot read properties of undefined (reading 'x')"), 'render'],
      ['text', 'unknown'],
      [null, 'unknown'],
      [{}, 'unknown'],
    ];
    for (const [error, cause] of cases) assert.equal(causeOf(error), cause, String(error));
  });

  it('adds the screen, device, version and a valid request name, never the text', () => {
    const error = tagRequest(new Error('secret@example.test'), 'supplier_link_queue');
    const detailed = withDetails(EVENT, error, CONTEXT);
    assert.deepEqual(detailed, {
      ...EVENT,
      screen: 'supplier-links',
      cause: 'render',
      device: 'desktop',
      request: 'supplier_link_queue',
      site_version: 'a1b2c3d',
    });
    assert.doesNotMatch(JSON.stringify(detailed), /secret/);
  });

  it('drops a request name or version that is not one', () => {
    const error = Object.assign(new Error('x'), { request: '/rest/v1/rpc/x?token=1' });
    const detailed = withDetails(EVENT, error, { ...CONTEXT, version: '' });
    assert.equal('request' in detailed, false);
    assert.equal('site_version' in detailed, false);
  });

  it('keeps the first request name an error was tagged with', () => {
    const error = tagRequest(new Error('x'), 'catalog_snapshot');
    tagRequest(error, 'supplier_link_queue');
    assert.equal((error as { request: string }).request, 'catalog_snapshot');
    assert.equal(tagRequest('text', 'x'), 'text');
  });

  it('holds errors until a reporter is set, then hands them over with the error', () => {
    const error = failure(500, 'system');
    reportBoundaryError(error, 'route', 'system');
    const received: [TelemetryEvent, unknown][] = [];
    setTelemetryReporter((event, cause) => {
      received.push([event, cause]);
    });
    try {
      assert.deepEqual(received, [
        [{ name: 'error', error_code: 'http_5xx', boundary: 'route', kind: 'system' }, error],
      ]);
    } finally {
      setTelemetryReporter(() => undefined);
    }
  });

  it('names the kinds in Hebrew, and shows an unknown one as it is', () => {
    assert.equal(kindLabel('system'), 'תקלה במערכת');
    assert.equal(kindLabel('mystery'), 'mystery');
  });
});
