import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spaFallback } from './define-app-config.ts';

/** Both Vite and Rollup hooks may be a plain function or `{ handler }`. */
function invokeHook(hook: unknown, ...args: unknown[]): void {
  const handler =
    typeof hook === 'function'
      ? hook
      : (hook as { handler?: (...args: unknown[]) => void } | undefined)
          ?.handler;
  handler?.(...args);
}

describe('spaFallback', () => {
  let outDir: string;

  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('only applies to builds, never to dev/preview', () => {
    // Vite reads `apply` before invoking any hook, so dev/preview runs never
    // call configResolved/closeBundle on this plugin at all.
    expect(spaFallback().apply).toBe('build');
  });

  it('copies index.html to 404.html after a build', () => {
    outDir = mkdtempSync(join(tmpdir(), 'spa-fallback-'));
    writeFileSync(join(outDir, 'index.html'), '<html>app</html>');
    const plugin = spaFallback();

    invokeHook(plugin.configResolved, {
      root: outDir,
      build: { outDir: '.' },
    });
    invokeHook(plugin.closeBundle);

    expect(readFileSync(join(outDir, '404.html'), 'utf8')).toBe(
      '<html>app</html>',
    );
  });

  it('does nothing when index.html is missing', () => {
    outDir = mkdtempSync(join(tmpdir(), 'spa-fallback-'));
    const plugin = spaFallback();

    invokeHook(plugin.configResolved, {
      root: outDir,
      build: { outDir: '.' },
    });
    expect(() => invokeHook(plugin.closeBundle)).not.toThrow();

    expect(existsSync(join(outDir, '404.html'))).toBe(false);
  });
});
