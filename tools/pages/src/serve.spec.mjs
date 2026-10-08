import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createPagesServer } from './serve.mjs';
import { startPagesServerProcess } from './serve.process-fixture.mjs';
import { TRAVERSAL_PROBES } from './serve.cases.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'serve-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** A root plus a sibling directory whose name starts with the root's name. */
function fixtureWithSibling() {
  const root = fixture({ 'index.html': '<p>root</p>' });
  const siblingName = `${basename(root)}-sibling`;
  const siblingDirectory = join(dirname(root), siblingName);
  const fileName = 'secret.txt';
  const secretContent = 'sibling secret';
  mkdirSync(siblingDirectory);
  writeFileSync(join(siblingDirectory, fileName), secretContent);
  return { root, siblingName, fileName, secretContent };
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

  it('answers a malformed percent-escape with 400 and keeps serving', async () => {
    const root = fixture({ 'index.html': '<p>root</p>' });
    server = createPagesServer({ root, base: '/' });
    const origin = await listen(server);

    const badResponse = await fetch(`${origin}/%E0%A4%A`);
    expect(badResponse.status).toBe(400);

    const okResponse = await fetch(`${origin}/index.html`);
    expect(okResponse.status).toBe(200);
  });

  it('answers an unknown path with a plain-text 404 when 404.html is missing, and keeps serving', async () => {
    const root = fixture({ 'index.html': '<p>root</p>' });
    server = createPagesServer({ root, base: '/' });
    const origin = await listen(server);

    const missingResponse = await fetch(`${origin}/no-such-page`);
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.headers.get('content-type')).toContain('text/plain');

    const okResponse = await fetch(`${origin}/index.html`);
    expect(okResponse.status).toBe(200);
  });

  describe('path-traversal probes', () => {
    it.each(TRAVERSAL_PROBES)(
      'never discloses a sibling directory via $name',
      async ({ buildPath }) => {
        const { root, siblingName, fileName, secretContent } =
          fixtureWithSibling();
        server = createPagesServer({ root, base: '/' });
        const origin = await listen(server);

        const response = await fetch(
          `${origin}/${buildPath(siblingName, fileName)}`,
        );

        expect([400, 404]).toContain(response.status);
        expect(await response.text()).not.toBe(secretContent);
      },
    );
  });

  describe('CLI subprocess', () => {
    let serverProcess;

    afterEach(async () => {
      await serverProcess?.stop();
      serverProcess = undefined;
    });

    it('binds to 127.0.0.1 when started with --host 127.0.0.1', async () => {
      const root = fixture({ 'index.html': '<p>root</p>' });
      serverProcess = await startPagesServerProcess({
        root,
        host: '127.0.0.1',
      });

      expect(serverProcess.boundAddress).toBe('127.0.0.1');
    }, 15_000);

    it('binds to the broad default address when --host is omitted', async () => {
      const root = fixture({ 'index.html': '<p>root</p>' });
      serverProcess = await startPagesServerProcess({ root });

      expect(serverProcess.boundAddress).not.toBe('127.0.0.1');
    }, 15_000);

    it('answers 404 instead of crashing when 404.html is a directory, and keeps serving', async () => {
      const root = fixture({ 'index.html': '<p>root</p>' });
      mkdirSync(join(root, '404.html'));
      serverProcess = await startPagesServerProcess({ root });

      const missingResponse = await fetch(
        `${serverProcess.baseUrl}/no-such-page`,
      );
      expect(missingResponse.status).toBe(404);

      const okResponse = await fetch(`${serverProcess.baseUrl}/index.html`);
      expect(okResponse.status).toBe(200);
    }, 15_000);

    it('answers 404 instead of crashing when the resolved index.html is a directory, and keeps serving', async () => {
      const root = fixture({ 'index.html': '<p>root</p>' });
      mkdirSync(join(root, 'nested', 'index.html'), { recursive: true });
      serverProcess = await startPagesServerProcess({ root });

      const nestedResponse = await fetch(`${serverProcess.baseUrl}/nested/`);
      expect(nestedResponse.status).toBe(404);

      const okResponse = await fetch(`${serverProcess.baseUrl}/index.html`);
      expect(okResponse.status).toBe(200);
    }, 15_000);
  });
});
