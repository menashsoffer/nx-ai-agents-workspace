import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPagesServer } from './serve.mjs';
import { TRAVERSAL_PROBES } from './serve.cases.mjs';
import { startServerProcess } from './serve.process-fixture.mjs';

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
  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
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

  describe('request hardening', () => {
    it('answers a malformed percent-escape with 400 and keeps serving', async () => {
      server = createPagesServer({ root: fixture({ 'index.html': 'ok' }) });
      const origin = await listen(server);

      const bad = await fetch(`${origin}/%E0%A4%A`);
      const next = await fetch(`${origin}/index.html`);

      expect(bad.status).toBe(400);
      expect(next.status).toBe(200);
    });

    it('answers an unknown path with a plain-text 404 when 404.html is missing, and keeps serving', async () => {
      server = createPagesServer({ root: fixture({ 'index.html': 'ok' }) });
      const origin = await listen(server);

      const missing = await fetch(`${origin}/nope`);
      const next = await fetch(`${origin}/index.html`);

      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-type')).toContain('text/plain');
      expect(next.status).toBe(200);
    });

    it.each(TRAVERSAL_PROBES)(
      'never serves a sibling folder file: %s',
      async (_name, buildPath) => {
        const parent = mkdtempSync(join(tmpdir(), 'serve-parent-'));
        const root = join(parent, 'site');
        mkdirSync(root);
        writeFileSync(join(root, 'index.html'), 'inside');
        mkdirSync(join(parent, 'site-private'));
        writeFileSync(join(parent, 'site-private', 'secret.txt'), 'TOP-SECRET');
        server = createPagesServer({ root });
        const origin = await listen(server);

        const response = await fetch(
          `${origin}${buildPath('site-private', 'secret.txt')}`,
        );

        expect([400, 404]).toContain(response.status);
        expect(await response.text()).not.toContain('TOP-SECRET');
      },
    );
  });

  describe('real CLI process', () => {
    let child;

    afterEach(async () => {
      await child?.stop();
    });

    it('binds to 127.0.0.1 with --host 127.0.0.1', async () => {
      child = await startServerProcess({
        root: fixture({ 'index.html': 'ok' }),
        host: '127.0.0.1',
      });

      expect(child.boundAddress).toBe('127.0.0.1');
    });

    it('binds to the broad default address without --host', async () => {
      child = await startServerProcess({
        root: fixture({ 'index.html': 'ok' }),
      });

      expect(child.boundAddress).not.toBe('127.0.0.1');
    });

    it('answers 404 when 404.html is a directory, and keeps serving', async () => {
      const root = fixture({ 'index.html': 'ok' });
      mkdirSync(join(root, '404.html'));
      child = await startServerProcess({ root });

      const missing = await fetch(`${child.baseUrl}/nope`);
      const next = await fetch(`${child.baseUrl}/index.html`);

      expect(missing.status).toBe(404);
      expect(next.status).toBe(200);
      expect(child.hasExited()).toBe(false);
    });

    it('answers 404 when the resolved index.html is a directory, and keeps serving', async () => {
      const root = fixture({ 'index.html': 'ok' });
      mkdirSync(join(root, 'nested', 'index.html'), { recursive: true });
      child = await startServerProcess({ root });

      const nested = await fetch(`${child.baseUrl}/nested/`);
      const next = await fetch(`${child.baseUrl}/index.html`);

      expect(nested.status).toBe(404);
      expect(next.status).toBe(200);
    });

    it.skipIf(process.getuid?.() === 0)(
      'answers 404 for a file it cannot open, and keeps serving',
      async () => {
        const root = fixture({ 'index.html': 'ok', 'locked.txt': 'x' });
        chmodSync(join(root, 'locked.txt'), 0o000);
        child = await startServerProcess({ root });

        const locked = await fetch(`${child.baseUrl}/locked.txt`);
        const next = await fetch(`${child.baseUrl}/index.html`);

        expect(locked.status).toBe(404);
        expect(next.status).toBe(200);
      },
    );
  });

  describe('process fixture cleanup', () => {
    it('rejects with stderr instead of hanging when the server never starts', async () => {
      const silentEntry = join(
        fixture({
          'silent.mjs': 'process.stderr.write("boom");setInterval(()=>{},1000)',
        }),
        'silent.mjs',
      );

      await expect(
        startServerProcess({
          root: tmpdir(),
          entryPoint: silentEntry,
          startupTimeoutMilliseconds: 300,
        }),
      ).rejects.toThrow(/did not start.*boom/s);
    });

    it('stop() on an already-exited child returns immediately', async () => {
      const child = await startServerProcess({
        root: fixture({ 'index.html': 'ok' }),
      });

      await child.stop();
      await child.stop();

      expect(child.hasExited()).toBe(true);
    });
  });
});
