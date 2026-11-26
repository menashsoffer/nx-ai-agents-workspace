import type { Access } from '../src/data/access.ts';
import { DataClient } from '../src/data/client.ts';

export const USER = '10000000-0000-0000-0000-000000000001';
export const OTHER_USER = '10000000-0000-0000-0000-000000000002';
export const SUPPLIER = '40000000-0000-0000-0000-000000000001';
export const TOKEN = token(USER);

export function token(userId: string): string {
  return `header.${btoa(JSON.stringify({ sub: userId }))}.signature`;
}
export function access(overrides: Partial<Access> = {}): Access {
  return {
    state: 'active',
    member: true,
    admin: false,
    editor: false,
    manager: false,
    grants: [{ role: 'viewer', unitId: 'u1' }],
    ...overrides,
  };
}
export function wireCatalog() {
  return {
    suppliers: [
      [
        SUPPLIER,
        'שם נוכחי',
        'company',
        'active',
        null,
        'verified',
        null,
        [['שם קודם', 'former_name', 0]],
        [[0, 0, 'כתיב נוסף', 2, '2020-01-01', '2028-01-01', null, 'registry_document', 'verified']],
        ['email'],
        'verified',
        null,
        null,
      ],
    ],
    registries: [
      ['r1', 'מאגר א', 'u1', 'active'],
      ['r2', 'מאגר ב', 'u2', 'active'],
    ],
    versions: [
      ['v1', 0, 0, null, null],
      ['v2', 1, null, null, null],
    ],
    fields: [
      ['f1', 0, 'תכנון כבישים'],
      ['f2', 1, 'ניהול'],
    ],
    categories: [
      ['root', 'הנדסה', null],
      ['c1', 'כבישים', 'root'],
      ['c2', 'תנועה', 'root'],
    ],
    fieldCategories: [
      ['f1', 'c1'],
      ['f1', 'c2'],
    ],
    units: [
      ['u1', 'אגף א'],
      ['u2', 'אגף ב'],
    ],
    documents: [['d1', 'https://example.test/source']],
  };
}
/** What supplier_detail returns for SUPPLIER, contact values included. */
export function wireDetail(overrides: Record<string, unknown> = {}) {
  return {
    identifiers: [],
    contacts: [
      {
        id: 'contact1',
        kind: 'email',
        value: 'bad',
        is_valid: false,
        source_document_id: 'd1',
        status: 'current',
      },
    ],
    audit: null,
    ...overrides,
  };
}
export function response(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER,
    access: access(),
    version: '1:roles',
    catalog: wireCatalog(),
    ...overrides,
  };
}
type Reply = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Response | Promise<Response>;
export function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('Missing test request body');
  return JSON.parse(init.body) as unknown;
}
export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : input.toString();
}
export function client(reply: Reply): DataClient {
  const fetcher: typeof fetch = (input, init) => Promise.resolve(reply(input, init));
  return new DataClient({ baseUrl: 'https://db.test', publicKey: 'key', token: TOKEN, fetcher });
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}
