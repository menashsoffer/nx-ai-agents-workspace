import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../../..');
const appsDir = join(workspaceRoot, 'apps');
const appDirNames = readdirSync(appsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const appNamesWithViteConfig = appDirNames.filter((name) =>
  existsSync(join(appsDir, name, 'vite.config.mts')),
);

function readConfiguredDevPort(appName: string): number {
  const source = readFileSync(
    join(appsDir, appName, 'vite.config.mts'),
    'utf8',
  );
  const match = /defineAppConfig\([^,]+,\s*{\s*port:\s*(\d+)/.exec(source);
  if (!match) {
    throw new Error(
      `apps/${appName}/vite.config.mts does not call defineAppConfig with a numeric port`,
    );
  }
  return Number(match[1]);
}

describe('app dev and preview ports', () => {
  it('finds at least one app using defineAppConfig', () => {
    expect(appNamesWithViteConfig.length).toBeGreaterThan(0);
  });

  it('configures a unique dev port and a unique preview port per app', () => {
    const devPorts = appNamesWithViteConfig.map(readConfiguredDevPort);
    const previewPorts = devPorts.map((port) => port + 100);

    expect(new Set(devPorts).size).toBe(devPorts.length);
    expect(new Set(previewPorts).size).toBe(previewPorts.length);
  });
});

describe('RTL Hebrew shell', () => {
  const appNamesWithIndexHtml = appDirNames.filter((name) =>
    existsSync(join(appsDir, name, 'index.html')),
  );

  it('finds at least one app with an index.html', () => {
    expect(appNamesWithIndexHtml.length).toBeGreaterThan(0);
  });

  it.each(appNamesWithIndexHtml)(
    'apps/%s/index.html declares <html lang="he" dir="rtl">',
    (name) => {
      const html = readFileSync(join(appsDir, name, 'index.html'), 'utf8');
      expect(html).toContain('<html lang="he" dir="rtl">');
    },
  );

  it("apps/docs/.vitepress/config.ts declares lang: 'he' and dir: 'rtl'", () => {
    const source = readFileSync(
      join(appsDir, 'docs/.vitepress/config.ts'),
      'utf8',
    );
    expect(source).toMatch(/lang:\s*'he'/);
    expect(source).toMatch(/dir:\s*'rtl'/);
  });
});
