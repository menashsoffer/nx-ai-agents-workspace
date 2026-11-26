import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SessionKeeper, REFRESH_MARGIN_MS } from '../src/data/auth-session.ts';
import { MemoryStorage } from '../src/data/memory-storage.ts';
import { SESSION_KEY, type Session } from '../src/data/session.ts';
import { DataError } from '../src/data/client.ts';

const NOW = 1_000_000_000;
type Reply = () => Promise<Response>;

function grant(token: string, refresh: string): Response {
  return Response.json({ access_token: token, expires_in: 3600, refresh_token: refresh });
}

function setup(stored: Session | null, replies: Reply[] = [], clock = { now: NOW }) {
  const storage = new MemoryStorage();
  if (stored) storage.setItem(SESSION_KEY, JSON.stringify(stored));
  const sent: string[] = [];
  const keeper = new SessionKeeper({
    storage,
    now: () => clock.now,
    refresh: (token) => {
      sent.push(token);
      const reply = replies.shift();
      return reply ? reply() : Promise.reject(new Error('no reply'));
    },
  });
  let signedOut = 0;
  keeper.onSignedOut(() => {
    signedOut += 1;
  });
  return { storage, sent, keeper, signedOut: () => signedOut };
}

const expired: Session = { token: 'old', exp: NOW - 1, refresh: 'r1' };

describe('session keeper', () => {
  it('keeps a session after the browser closes and renews its expired access token', async () => {
    const { keeper, sent, storage } = setup(expired, [() => Promise.resolve(grant('new', 'r2'))]);
    const session = await keeper.fresh();
    assert.equal(session?.token, 'new');
    assert.deepEqual(sent, ['r1']);
    const saved = JSON.parse(storage.getItem(SESSION_KEY) ?? '{}') as Session;
    assert.equal(saved.refresh, 'r2');
    assert.equal(saved.exp, NOW + 3600 * 1000);
  });

  it('does not call the server while the access token has time left', async () => {
    const live = { token: 'live', exp: NOW + REFRESH_MARGIN_MS + 1, refresh: 'r1' };
    const { keeper, sent } = setup(live);
    assert.equal((await keeper.fresh())?.token, 'live');
    assert.deepEqual(sent, []);
  });

  it('renews once when several requests need a token at the same time', async () => {
    const { keeper, sent } = setup(expired, [() => Promise.resolve(grant('new', 'r2'))]);
    const [a, b] = await Promise.all([keeper.fresh(), keeper.fresh()]);
    assert.equal(a?.token, 'new');
    assert.equal(b?.token, 'new');
    assert.deepEqual(sent, ['r1']);
  });

  it('signs out when the server rejects the refresh token', async () => {
    const { keeper, storage, signedOut } = setup(expired, [
      () => Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 })),
    ]);
    assert.equal(await keeper.fresh(), null);
    assert.equal(storage.getItem(SESSION_KEY), null);
    assert.equal(keeper.current(), null);
    assert.equal(signedOut(), 1);
  });

  it('keeps the session when the network fails, so the user can try again', async () => {
    const { keeper, storage, signedOut } = setup(expired, [() => Promise.reject(new Error('x'))]);
    await assert.rejects(keeper.fresh(), (error) => error instanceof DataError);
    assert.notEqual(storage.getItem(SESSION_KEY), null);
    assert.equal(signedOut(), 0);
  });

  it('signs out an old session that has no refresh token', async () => {
    const { keeper, sent, signedOut } = setup({ token: 'old', exp: NOW - 1, refresh: null });
    assert.equal(keeper.current(), null);
    assert.equal(await keeper.fresh(), null);
    assert.deepEqual(sent, []);
    assert.equal(signedOut(), 0);
  });

  it('uses a token another tab already renewed instead of spending the refresh token again', async () => {
    const { keeper, storage, sent } = setup(expired);
    const renewed = { token: 'other-tab', exp: NOW + 3600 * 1000, refresh: 'r2' };
    storage.setItem(SESSION_KEY, JSON.stringify(renewed));
    assert.equal((await keeper.recover('old'))?.token, 'other-tab');
    assert.deepEqual(sent, []);
  });

  it('renews after the server rejects a token that still looked valid', async () => {
    const live = { token: 'revoked', exp: NOW + 3600 * 1000, refresh: 'r1' };
    const { keeper, sent } = setup(live, [() => Promise.resolve(grant('new', 'r2'))]);
    assert.equal((await keeper.recover('revoked'))?.token, 'new');
    assert.deepEqual(sent, ['r1']);
  });

  it('forgets the session on sign-out without telling the listeners', () => {
    const live = { token: 'live', exp: NOW + 3600 * 1000, refresh: 'r1' };
    const { keeper, storage, signedOut } = setup(live);
    keeper.clear();
    assert.equal(storage.getItem(SESSION_KEY), null);
    assert.equal(keeper.current(), null);
    assert.equal(signedOut(), 0);
  });
});

describe('session keeper in the browser', () => {
  it('uses a valid session without a refresh token until it expires', async () => {
    const { keeper, sent } = setup({ token: 'short', exp: NOW + 1000, refresh: null });
    assert.equal((await keeper.fresh())?.token, 'short');
    assert.equal(await keeper.recover('short'), null);
    assert.deepEqual(sent, []);
  });

  it('tells the listeners when another tab signs out', () => {
    const live = { token: 'live', exp: NOW + 3600 * 1000, refresh: 'r1' };
    const { keeper, storage, signedOut } = setup(live);
    storage.removeItem(SESSION_KEY);
    keeper.reload();
    assert.equal(keeper.current(), null);
    assert.equal(signedOut(), 1);
  });

  it('renews under a lock shared by all tabs', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SESSION_KEY, JSON.stringify(expired));
    const names: string[] = [];
    const locks = {
      request: (name: string, run: () => Promise<Session | null>) => {
        names.push(name);
        return run();
      },
    } as unknown as Pick<LockManager, 'request'>;
    const keeper = new SessionKeeper({
      storage,
      locks,
      now: () => NOW,
      refresh: () => Promise.resolve(grant('new', 'r2')),
    });
    assert.equal((await keeper.fresh())?.token, 'new');
    assert.equal(names.length, 1);
  });

  it('renews on a timer shortly before the access token expires', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const soon = { token: 'soon', exp: NOW + REFRESH_MARGIN_MS + 5000, refresh: 'r1' };
    const clock = { now: NOW };
    const { keeper, sent } = setup(soon, [() => Promise.resolve(grant('new', 'r2'))], clock);
    keeper.start();
    t.mock.timers.tick(4999);
    assert.deepEqual(sent, []);
    clock.now = NOW + 5000;
    t.mock.timers.tick(1);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    assert.deepEqual(sent, ['r1']);
  });

  it('signs out when the server answers a renewal with no usable session', async () => {
    const { keeper, signedOut } = setup(expired, [() => Promise.resolve(Response.json({}))]);
    assert.equal(await keeper.fresh(), null);
    assert.equal(signedOut(), 1);
  });

  it('keeps the session when the auth server has a temporary failure', async () => {
    const { keeper, signedOut } = setup(expired, [
      () => Promise.resolve(new Response(null, { status: 503 })),
    ]);
    await assert.rejects(keeper.fresh(), (error) => error instanceof DataError);
    assert.equal(signedOut(), 0);
  });
});
