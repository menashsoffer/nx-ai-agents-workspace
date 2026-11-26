import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { CBS_URL, handle, JOB, type Context } from '../threshold-index/index.ts';
import { periodsAround } from '../threshold-index/periods.ts';

const ENV = { url: 'https://project.test', publicKey: 'pk', secretKey: 'sk' };

// The shape of the real CBS answer (checked 16.11.2026), trimmed to two months.
function cbsAnswer(months: [number, number][]) {
  return {
    month: [
      {
        code: 120010,
        date: months.map(([year, month]) => ({
          year,
          month,
          prevBase: [{ baseDesc: '1985 ממוצע', value: month === 10 ? 1149.48641267994 : 1150.6 }],
        })),
      },
    ],
  };
}

interface Call {
  readonly path: string;
  readonly auth: string | null;
  readonly body: Record<string, unknown> | null;
}

interface Fake {
  readonly calls: Call[];
  readonly fetcher: typeof fetch;
}

function fake(cbs: Response, answers: Record<string, unknown> = {}): Fake {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === CBS_URL) return cbs.clone();
    const path = new URL(url).pathname.replace('/rest/v1/rpc/', '');
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
    calls.push({ path, auth: new Headers(init?.headers).get('authorization'), body });
    return Promise.resolve(Response.json(path in answers ? answers[path] : 'proposed'));
  };
  return { calls, fetcher };
}

function ctx(fetcher: typeof fetch, today = '2026-11-16'): Context {
  return { env: ENV, fetcher, today };
}

const post = () => new Request('https://fn.test', { method: 'POST' });

describe('threshold periods', () => {
  it('uses the previous month index from the 16th', () => {
    assert.deepEqual(periodsAround('2026-11-16'), [
      { startsOn: '2026-11-16', year: 2026, month: 10 },
      { startsOn: '2026-12-16', year: 2026, month: 11 },
    ]);
    assert.deepEqual(periodsAround('2026-01-15'), [
      { startsOn: '2025-12-16', year: 2025, month: 11 },
      { startsOn: '2026-01-16', year: 2025, month: 12 },
    ]);
  });
});

describe('threshold-index', () => {
  it('proposes the published month and waits for the next one', async () => {
    const { calls, fetcher } = fake(
      Response.json(
        cbsAnswer([
          [2026, 9],
          [2026, 10],
        ]),
      ),
      {
        job_start: 5,
      },
    );
    const response = await handle(post(), ctx(fetcher));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      periods: [
        { starts_on: '2026-11-16', result: 'proposed' },
        { starts_on: '2026-12-16', result: 'not_published' },
      ],
    });
    const [start, proposal, finish] = calls as [Call, Call, Call];
    assert.deepEqual(start.body, { job_name: JOB, min_gap_minutes: 30 });
    assert.equal(proposal.path, 'propose_threshold');
    assert.equal(proposal.auth, 'Bearer sk', 'written with the secret key');
    assert.equal(proposal.body?.cpi, 1149.4864);
    assert.equal(proposal.body.starts_on, '2026-11-16');
    assert.equal(finish.path, 'job_finish');
    assert.equal(finish.body?.run_status, 'ok');
  });

  it('skips without calling CBS when a run started recently', async () => {
    const { calls, fetcher } = fake(Response.json({}), { job_start: null });
    const response = await handle(post(), ctx(fetcher));
    assert.deepEqual(await response.json(), { skipped: true });
    assert.equal(calls.length, 1);
  });

  it('logs a failed run when CBS is down or changes its format', async () => {
    for (const cbs of [new Response('', { status: 500 }), Response.json({ month: 'x' })]) {
      const { calls, fetcher } = fake(cbs, { job_start: 6 });
      const response = await handle(post(), ctx(fetcher));
      assert.equal(response.status, 502);
      assert.equal(calls.at(-1)?.body?.run_status, 'failed');
    }
  });

  it('accepts only POST and needs the server settings', async () => {
    const { fetcher } = fake(Response.json({}));
    const get = new Request('https://fn.test');
    assert.equal((await handle(get, ctx(fetcher))).status, 405);
    assert.equal((await handle(post(), { ...ctx(fetcher), env: null })).status, 503);
  });
});
