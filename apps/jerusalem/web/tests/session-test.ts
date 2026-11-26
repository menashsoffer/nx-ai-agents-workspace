import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  base64Url,
  EXPIRED_MESSAGE,
  exchangeGoogleCode,
  FAILED_MESSAGE,
  googleAuthorizeUrl,
  PKCE_KEY,
  SESSION_KEY,
  storeSession,
  takeAuthError,
  takeSession,
  type BrowserContext,
} from '../src/data/session.ts';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

function context(href: string) {
  const url = new URL(href);
  const replaced: string[] = [];
  const ctx: BrowserContext = {
    location: { href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: {
      replaceState: (_data, _unused, next) => {
        replaced.push(String(next));
      },
    },
    storage: new MemoryStorage(),
  };
  return { ctx, replaced };
}

const json =
  (value: unknown, status = 200) =>
  () =>
    Promise.resolve(Response.json(value, { status }));

describe('takeAuthError', () => {
  it('returns nothing and leaves the address alone without an error', () => {
    const { ctx, replaced } = context('https://site.test/app/?x=1#/catalog');
    assert.equal(takeAuthError(ctx), '');
    assert.deepEqual(replaced, []);
  });

  it('explains an expired link from the fragment and removes the error and the verifier', () => {
    const { ctx, replaced } = context(
      'https://site.test/app/#error=access_denied&error_code=otp_expired&error_description=x',
    );
    ctx.storage.setItem(PKCE_KEY, 'v');
    assert.equal(takeAuthError(ctx), EXPIRED_MESSAGE);
    assert.deepEqual(replaced, ['/app/']);
    assert.equal(ctx.storage.getItem(PKCE_KEY), null);
  });

  it('reports any other error from the query string as a failed sign-in', () => {
    const { ctx, replaced } = context('https://site.test/app/?error=server_error&keep=1');
    assert.equal(takeAuthError(ctx), FAILED_MESSAGE);
    assert.deepEqual(replaced, ['/app/?keep=1']);
  });

  it('treats an error code without an error name as an error', () => {
    const { ctx } = context('https://site.test/?error_code=flow_state_expired');
    assert.equal(takeAuthError(ctx), EXPIRED_MESSAGE);
  });
});

describe('takeSession', () => {
  it('keeps a token from a magic-link redirect and clears the fragment', () => {
    const { ctx, replaced } = context('https://site.test/app/?a=1#access_token=t1&expires_in=60');
    const before = Date.now();
    const session = takeSession(ctx);
    assert.ok(session);
    assert.equal(session.token, 't1');
    assert.ok(session.exp >= before + 60_000);
    assert.deepEqual(replaced, ['/app/?a=1']);
  });

  it('defaults to an hour when the redirect has no lifetime', () => {
    const { ctx } = context('https://site.test/#access_token=t2&expires_in=zero');
    const exp = takeSession(ctx)?.exp ?? 0;
    assert.ok(exp > Date.now() + 3_599_000);
  });

  it('returns a stored session only while it is valid and well formed', () => {
    const { ctx } = context('https://site.test/');
    assert.equal(takeSession(ctx), null);
    for (const raw of ['not json', 'null', '"text"', '{"token":1,"exp":1}']) {
      ctx.storage.setItem(SESSION_KEY, raw);
      assert.equal(takeSession(ctx), null, raw);
    }
    ctx.storage.setItem(SESSION_KEY, JSON.stringify({ token: 'old', exp: Date.now() - 1 }));
    assert.equal(takeSession(ctx), null);
    storeSession(ctx.storage, { token: 'live', expiresIn: 10, refresh: null });
    assert.equal(takeSession(ctx)?.token, 'live');
  });
});

describe('base64Url', () => {
  const bytes = new Uint8Array([251, 255, 191, 0]);

  it('encodes without padding in the URL alphabet with the fallback encoder', () => {
    const plain = new Uint8Array(bytes);
    Object.defineProperty(plain, 'toBase64', { value: undefined });
    assert.equal(base64Url(plain), '-_-_AA');
  });

  it('uses the built-in encoder where the runtime has one', () => {
    const native = new Uint8Array(bytes);
    Object.defineProperty(native, 'toBase64', {
      value(this: Uint8Array, options: unknown) {
        assert.deepEqual(options, { alphabet: 'base64url', omitPadding: true });
        assert.equal(this, native);
        return 'native';
      },
    });
    assert.equal(base64Url(native), 'native');
  });
});

describe('Google sign-in', () => {
  it('stores a verifier and builds an authorize URL with its S256 challenge', async () => {
    const { ctx } = context('https://site.test/');
    const url = new URL(await googleAuthorizeUrl(ctx, 'https://db.test', 'https://site.test/'));
    const verifier = ctx.storage.getItem(PKCE_KEY) ?? '';
    assert.match(verifier, /^[0-9a-f]{64}$/);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    assert.equal(url.origin + url.pathname, 'https://db.test/auth/v1/authorize');
    assert.equal(url.searchParams.get('provider'), 'google');
    assert.equal(url.searchParams.get('code_challenge'), base64Url(new Uint8Array(digest)));
    assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  });

  it('does nothing without a code in the address', async () => {
    const { ctx } = context('https://site.test/');
    await exchangeGoogleCode(ctx, () => assert.fail('no exchange expected'));
    assert.equal(ctx.storage.getItem(SESSION_KEY), null);
  });

  it('trades the code once, removes it from the address and stores the session', async () => {
    const { ctx, replaced } = context('https://site.test/app/?code=c1&x=1');
    ctx.storage.setItem(PKCE_KEY, 'verifier');
    await exchangeGoogleCode(ctx, (code, verifier) => {
      assert.deepEqual([code, verifier], ['c1', 'verifier']);
      return json({ access_token: 'tok', expires_in: 120 })();
    });
    assert.deepEqual(replaced, ['/app/?x=1']);
    assert.equal(ctx.storage.getItem(PKCE_KEY), null);
    assert.equal(
      (JSON.parse(ctx.storage.getItem(SESSION_KEY) ?? '{}') as { token: string }).token,
      'tok',
    );
  });

  it('fails without a stored verifier, on a refused exchange or on a bad session', async () => {
    const { ctx } = context('https://site.test/?code=c');
    await assert.rejects(exchangeGoogleCode(ctx, json({})), /missing verifier/);
    const cases: [() => Promise<Response>, RegExp][] = [
      [json({}, 400), /exchange failed/],
      [json(null), /invalid session/],
      [json({ access_token: '', expires_in: 60 }), /invalid session/],
      [json({ access_token: 'tok', expires_in: 0 }), /invalid session/],
    ];
    for (const [exchange, error] of cases) {
      const next = context('https://site.test/?code=c').ctx;
      next.storage.setItem(PKCE_KEY, 'v');
      await assert.rejects(exchangeGoogleCode(next, exchange), error);
      assert.equal(next.storage.getItem(SESSION_KEY), null);
    }
  });
});
