import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPagesServer } from './serve.mjs';

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
});
