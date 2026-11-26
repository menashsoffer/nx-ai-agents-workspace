import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryStorage } from '../src/data/memory-storage.ts';
import {
  SESSION_KEY,
  nextFromHash,
  parseGrant,
  parseSession,
  rememberNext,
  takeNext,
  takeSession,
  type BrowserContext,
} from '../src/data/session.ts';
import { prepareAdmin } from '../src/features/auth/api/bootstrap.ts';
import { endedStart, signInPath } from '../src/app-shell/session-watch.ts';

function context(href: string, storage: Storage = new MemoryStorage()): BrowserContext {
  const url = new URL(href);
  return {
    location: { href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { replaceState: () => undefined },
    storage,
  };
}

describe('saved session', () => {
  it('keeps the refresh token from an email link', () => {
    const ctx = context('https://site.test/#access_token=a&expires_in=60&refresh_token=r');
    assert.equal(takeSession(ctx)?.refresh, 'r');
    const saved = JSON.parse(ctx.storage.getItem(SESSION_KEY) ?? '{}') as { refresh: string };
    assert.equal(saved.refresh, 'r');
  });

  it('keeps an expired session only when it can be renewed', () => {
    const old = (refresh: string | null) => JSON.stringify({ token: 't', exp: 1, refresh });
    assert.equal(parseSession(old('r'))?.refresh, 'r');
    assert.equal(parseSession(old(null)), null);
    assert.equal(parseSession(old('')), null);
  });

  it('reads only complete token answers from Supabase', () => {
    const full = { access_token: 'a', expires_in: 3600, refresh_token: 'r' };
    assert.deepEqual(parseGrant(full), { token: 'a', expiresIn: 3600, refresh: 'r' });
    assert.equal(parseGrant({ ...full, refresh_token: undefined })?.refresh, null);
    assert.equal(parseGrant({ access_token: '', expires_in: 1 }), null);
    assert.equal(parseGrant({ access_token: 'a' }), null);
    assert.equal(parseGrant(null), null);
  });
});

describe('return to the previous screen', () => {
  it('reads the next screen from the address and refuses other sites', () => {
    assert.equal(nextFromHash('#/auth?next=%2Fusers%3Fq%3D1'), '/users?q=1');
    assert.equal(nextFromHash('#/auth?next=%2F%2Fevil.test'), null);
    assert.equal(nextFromHash('#/auth?next=https%3A%2F%2Fevil.test'), null);
    assert.equal(nextFromHash('#/auth'), null);
  });

  it('remembers the screen once, across the trip to Google or the email link', () => {
    const storage = new MemoryStorage();
    rememberNext(storage, '/thresholds');
    assert.equal(takeNext(storage), '/thresholds');
    assert.equal(takeNext(storage), null);
    rememberNext(storage, '/x');
    rememberNext(storage, null);
    assert.equal(takeNext(storage), null);
  });

  it('returns to the screen only after a sign-in that came back to the site', async () => {
    const storage = new MemoryStorage();
    rememberNext(storage, '/users');
    const back = context('https://site.test/#access_token=a&expires_in=60', storage);
    assert.equal((await prepareAdmin(back)).next, '/users');
    rememberNext(storage, '/users');
    const ordinary = await prepareAdmin(context('https://site.test/#/catalog', storage));
    assert.equal(ordinary.next, null);
  });

  it('builds the sign-in address with the screen to return to', () => {
    assert.equal(
      signInPath({ pathname: '/users', search: '?q=1' }, true),
      '/auth?next=%2Fusers%3Fq%3D1&reason=expired',
    );
    assert.equal(signInPath({ pathname: '/users', search: '' }), '/auth?next=%2Fusers');
    assert.equal(endedStart('#/users?q=1'), '/auth?next=%2Fusers%3Fq%3D1&reason=expired');
    assert.equal(endedStart(''), '/auth?next=%2F&reason=expired');
    assert.equal(signInPath({ pathname: '/auth', search: '?next=%2Fx' }), '/auth');
  });
});
