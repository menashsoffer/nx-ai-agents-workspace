import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createPagesServer } from './serve.mjs';
import { TRAVERSAL_PROBE_CASES } from './serve.cases.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'serve-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** Starts a server on an ephemeral port and returns its base URL. */
function listen(server) {
  return new Promise((resolvePromise) => {
    server.listen(0, () => {
      const { port } = server.address();
      resolvePromise(`http://127.0.0.1:${port}`);
    });
  });
}

/** Starts a server, optionally on a given host, and returns its address info. */
function listenOnHost(server, host) {
  return new Promise((resolvePromise) => {
    const onListening = () => resolvePromise(server.address());
    if (host === undefined) server.listen(0, onListening);
    else server.listen(0, host, onListening);
  });
}

describe('createPagesServer', () => {
  let server;

  afterEach(() => {
    server?.close();
  });

  describe.each([
    ['without a trailing slash', '/repo'],
    ['with a trailing slash', '/repo/'],
  ])('with a base path %s (%s)', (_name, base) => {
    beforeEach(() => {
      const root = fixture({
        'index.html': '<p>root</p>',
        'about/index.html': '<p>about</p>',
        '404.html': '<p>not found</p>',
      });
      server = createPagesServer({ root, base });
    });

    it('serves a file under the base path', async () => {
      const origin = await listen(server);
      const response = await fetch(`${origin}/repo/index.html`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<p>root</p>');
    });

    it("serves a directory's index.html under the base path", async () => {
      const origin = await listen(server);
      const response = await fetch(`${origin}/repo/about/`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<p>about</p>');
    });

    it('answers an unknown path under the base with 404.html at status 404', async () => {
      const origin = await listen(server);
      const response = await fetch(`${origin}/repo/no-such-page`);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('<p>not found</p>');
    });
  });

  describe('without a 404.html in the root', () => {
    beforeEach(() => {
      const root = fixture({ 'index.html': '<p>root</p>' });
      server = createPagesServer({ root, base: '/' });
    });

    it('answers an unknown path with a plain-text 404 and keeps serving', async () => {
      const origin = await listen(server);
      const response = await fetch(`${origin}/no-such-page`);

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toMatch(/text\/plain/);
      expect((await response.text()).length).toBeGreaterThan(0);

      const followUp = await fetch(`${origin}/index.html`);
      expect(followUp.status).toBe(200);
    });
  });

  describe('request hardening', () => {
    let root;
    let siblingName;

    beforeEach(() => {
      root = fixture({ 'index.html': '<p>root</p>' });
      siblingName = `${basename(root)}-evil`;
      mkdirSync(join(root, '..', siblingName), { recursive: true });
      writeFileSync(
        join(root, '..', siblingName, 'secret.txt'),
        'SIBLING SECRET',
      );
      server = createPagesServer({ root, base: '/' });
    });

    it('answers a malformed percent-escape with 400 and keeps serving', async () => {
      const origin = await listen(server);
      const malformed = await fetch(`${origin}/%E0%A4%A`);
      expect(malformed.status).toBe(400);

      const followUp = await fetch(`${origin}/index.html`);
      expect(followUp.status).toBe(200);
    });

    it.each(TRAVERSAL_PROBE_CASES)(
      'rejects %s (%s) without leaking the sibling file',
      async (_label, probe) => {
        const origin = await listen(server);
        const path = probe
          .replace('<sibling>', siblingName)
          .replace('<file>', 'secret.txt');
        const response = await fetch(`${origin}/${path}`);

        expect([400, 404]).toContain(response.status);
        expect(await response.text()).not.toBe('SIBLING SECRET');
      },
    );
  });

  describe('listen address', () => {
    beforeEach(() => {
      server = createPagesServer({ root: fixture({}), base: '/' });
    });

    it('binds to the given host when one is provided', async () => {
      const address = await listenOnHost(server, '127.0.0.1');
      expect(address.address).toBe('127.0.0.1');
    });

    it('binds to the same default host as before when none is provided', async () => {
      const plainServer = createServer();
      const defaultAddress = await new Promise((resolvePromise) =>
        plainServer.listen(0, () => resolvePromise(plainServer.address())),
      );
      plainServer.close();

      const address = await listenOnHost(server);
      expect(address.address).toBe(defaultAddress.address);
    });
  });
});
