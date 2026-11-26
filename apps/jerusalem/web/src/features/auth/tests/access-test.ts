import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { identity, permitted, requireRoles, setAdminSession } from '../../../data/rpc.ts';
import { DataError } from '../../../data/client.ts';
import type { Access, Role } from '../../../data/access.ts';
import { prepareAdmin } from '../api/bootstrap.ts';
import { SESSION_KEY, type BrowserContext } from '../../../data/session.ts';

const USER = '10000000-0000-4000-8000-000000000001';
const originalFetch = globalThis.fetch;
const roleAccess = (role: Role, state: Access['state'] = 'active'): Access => ({
  state,
  member: true,
  admin: role === 'admin',
  editor: role === 'editor',
  manager: role === 'unit_manager',
  grants: [{ role, unitId: role === 'admin' ? null : USER }],
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  setAdminSession(null);
});
function context(url: string): BrowserContext {
  const location = new URL(url);
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  const history = {
    replaceState: (_value: unknown, _title: string, url?: string | URL | null) => {
      if (url) location.href = new URL(url, location).href;
    },
  };
  return { location, history, storage };
}
describe('admin auth and route permissions', () => {
  for (const role of ['viewer', 'editor', 'unit_manager', 'admin', 'auditor'] as const) {
    it(`checks ${role} against explicit allowed roles`, () => {
      const access = roleAccess(role);
      assert.equal(permitted(access, ['admin']), role === 'admin');
      assert.equal(permitted(access, [role]), true);
      for (const state of ['pending', 'blocked', 'rejected', 'unregistered'] as const)
        assert.equal(permitted({ ...access, state }, [role]), false);
    });
  }
  it('loads existing access functions and rejects a viewer on an admin-only route', async () => {
    const token = `x.${Buffer.from(JSON.stringify({ sub: USER, app_metadata: { role: 'admin' } })).toString('base64url')}.x`;
    setAdminSession({ token, exp: Date.now() + 60_000, refresh: null });
    const calls: string[] = [];
    globalThis.fetch = (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      calls.push(url.pathname);
      assert.ok(url.pathname.endsWith('catalog_snapshot'));
      return Promise.resolve(
        Response.json({
          user_id: USER,
          version: 'test',
          access: roleAccess('viewer'),
          catalog: {
            suppliers: [],
            registries: [],
            versions: [],
            fields: [],
            categories: [],
            fieldCategories: [],
            units: [],
            documents: [],
          },
        }),
      );
    };
    const who = await identity();
    assert.equal(who.userId, USER);
    assert.equal(who.access.admin, false);
    await assert.rejects(
      requireRoles(['admin']),
      (error: unknown) => error instanceof DataError && error.status === 403,
    );
    assert.equal(calls.filter((p) => p.endsWith('catalog_snapshot')).length, 2);
    assert.equal(
      calls.some((p) => p.includes('/auth/v1/user')),
      false,
    );
  });
  it('rejects an expired session before requesting roles', async () => {
    setAdminSession({ token: 'expired', exp: 1, refresh: null });
    globalThis.fetch = () => {
      throw Error('must not fetch');
    };
    await assert.rejects(
      identity(),
      (error: unknown) => error instanceof DataError && error.status === 401,
    );
  });
  it('consumes a token fragment before hash routing starts', async () => {
    const ctx = context('https://test.invalid/#access_token=example&expires_in=3600');
    const result = await prepareAdmin(ctx);
    assert.equal(result.session?.token, 'example');
    assert.equal(ctx.location.hash, '');
    assert.equal(ctx.location.pathname, '/');
  });
  it('keeps an ordinary hash route and explains a failed callback without reusing an old session', async () => {
    const normal = context('https://test.invalid/#/auth');
    await prepareAdmin(normal);
    assert.equal(normal.location.hash, '#/auth');
    const expired = context('https://test.invalid/#error=access_denied&error_code=otp_expired');
    expired.storage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: 'previous', exp: Date.now() + 60_000, refresh: null }),
    );
    const result = await prepareAdmin(expired);
    assert.equal(result.session, null);
    assert.match(result.message, /תוקף ניסיון ההתחברות פג/);
    assert.equal(expired.storage.getItem(SESSION_KEY), null);
    assert.equal(expired.location.hash, '');
  });
});
