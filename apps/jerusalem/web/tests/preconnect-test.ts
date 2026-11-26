import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';

import { JSDOM } from 'jsdom';
import { build } from 'vite';

it('injects a cross-origin preconnect using the same configured origin as the built CSP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-build-'));
  const previous = process.env.VITE_SUPABASE_URL;
  process.env.VITE_SUPABASE_URL = 'https://staging.example.test/';
  try {
    await build({
      configFile: 'vite.config.mjs',
      logLevel: 'silent',
      build: { outDir: directory, emptyOutDir: true },
    });
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    const dom = new JSDOM(html);
    const link = dom.window.document.querySelector<HTMLLinkElement>('head link[rel="preconnect"]');
    assert.ok(link);
    assert.equal(link.href, 'https://staging.example.test/');
    assert.equal(link.hasAttribute('crossorigin'), true);
    const policy = dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    assert.match(
      policy?.getAttribute('content') ?? '',
      /connect-src 'self' https:\/\/staging.example.test;/,
    );
    dom.window.close();
  } finally {
    if (previous === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
