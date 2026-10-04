import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defineAppConfig } from './define-app-config.ts';

const workspaceRoot = resolve(import.meta.dirname, '../../../..');
const siteRoot = join(workspaceRoot, 'apps/site');
const sandboxRoot = join(workspaceRoot, 'apps/sandbox');
const ORIGINAL_BASE_PATH = process.env['BASE_PATH'];

afterEach(() => {
  if (ORIGINAL_BASE_PATH === undefined) delete process.env['BASE_PATH'];
  else process.env['BASE_PATH'] = ORIGINAL_BASE_PATH;
});

describe('defineAppConfig base path', () => {
  it('uses BASE_PATH as the base when it is set', () => {
    process.env['BASE_PATH'] = '/my-repo/';
    expect(defineAppConfig(siteRoot, { port: 4200 }).base).toBe('/my-repo/');
  });

  it('defaults base to "/" when BASE_PATH is unset', () => {
    delete process.env['BASE_PATH'];
    expect(defineAppConfig(siteRoot, { port: 4200 }).base).toBe('/');
  });

  it('reads BASE_PATH at config-creation time, not lazily', () => {
    process.env['BASE_PATH'] = '/first/';
    const config = defineAppConfig(siteRoot, { port: 4200 });
    process.env['BASE_PATH'] = '/second/';
    expect(config.base).toBe('/first/');
  });
});

describe('defineAppConfig ports and cacheDir', () => {
  it('derives the preview port as the dev port plus 100, per project', () => {
    const site = defineAppConfig(siteRoot, { port: 4200 });
    const sandbox = defineAppConfig(sandboxRoot, { port: 4201 });

    expect(site.server?.port).toBe(4200);
    expect(site.preview?.port).toBe(4300);
    expect(sandbox.server?.port).toBe(4201);
    expect(sandbox.preview?.port).toBe(4301);
  });

  it('gives each project its own cacheDir', () => {
    const site = defineAppConfig(siteRoot, { port: 4200 });
    const sandbox = defineAppConfig(sandboxRoot, { port: 4201 });

    expect(site.cacheDir).not.toBe(sandbox.cacheDir);
  });
});
