import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeEntry,
  ChecksumError,
  ensureTool,
  sha256,
} from './fetch-tool.mjs';

/** A tarball containing an executable `faketool`, served via file://. */
function fakeRelease() {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/faketool'), '#!/bin/sh\necho fake 1.0\n', {
    mode: 0o755,
  });
  const archive = join(dir, 'faketool.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', join(dir, 'src'), 'faketool']);
  return archive;
}

const manifestFor = (archive, hash) => ({
  tools: {
    faketool: {
      version: '1.0.0',
      binary: 'faketool',
      platforms: { 'linux-x64': { url: `file://${archive}`, sha256: hash } },
    },
  },
});

// file:// is refused unless a caller opts in; only these tests do.
const testOnly = { allowFileUrls: true };

describe('ensureTool', () => {
  it('downloads, verifies and caches a matching archive', () => {
    const archive = fakeRelease();
    const cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const manifest = manifestFor(archive, sha256(archive));

    const binary = ensureTool('faketool', 'linux-x64', {
      manifest,
      cacheDir,
      ...testOnly,
    });
    expect(execFileSync(binary, { encoding: 'utf8' })).toBe('fake 1.0\n');
    // cached: a second call works without the source archive
    execFileSync('rm', [archive]);
    expect(
      ensureTool('faketool', 'linux-x64', { manifest, cacheDir, ...testOnly }),
    ).toBe(binary);
  });

  it('rejects a checksum mismatch and leaves nothing behind', () => {
    const archive = fakeRelease();
    const cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const manifest = manifestFor(archive, '0'.repeat(64));

    expect(() =>
      ensureTool('faketool', 'linux-x64', { manifest, cacheDir, ...testOnly }),
    ).toThrow(ChecksumError);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('refuses unknown tools and platforms', () => {
    const manifest = manifestFor('/nope', '0'.repeat(64));
    expect(() => ensureTool('other', 'linux-x64', { manifest })).toThrow(
      /Unknown tool/,
    );
    expect(() => ensureTool('faketool', 'darwin-arm64', { manifest })).toThrow(
      /no darwin-arm64/,
    );
    expect(existsSync('/nope')).toBe(false);
  });

  it('re-hashes the cache and restores a tampered binary before returning it', () => {
    const archive = fakeRelease();
    const cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const manifest = manifestFor(archive, sha256(archive));
    const opts = { manifest, cacheDir, ...testOnly };

    const binary = ensureTool('faketool', 'linux-x64', opts);
    rmSync(archive); // the source is gone: only the cache can restore it
    writeFileSync(binary, '#!/bin/sh\necho pwned\n', { mode: 0o755 });
    expect(ensureTool('faketool', 'linux-x64', opts)).toBe(binary);
    expect(execFileSync(binary, { encoding: 'utf8' })).toBe('fake 1.0\n');
  });

  it('replaces a planted symlink instead of writing through it', () => {
    const archive = fakeRelease();
    const cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const manifest = manifestFor(archive, sha256(archive));
    const opts = { manifest, cacheDir, ...testOnly };

    const binary = ensureTool('faketool', 'linux-x64', opts);
    const victim = join(mkdtempSync(join(tmpdir(), 'victim-')), 'file');
    writeFileSync(victim, 'untouched');
    rmSync(binary);
    symlinkSync(victim, binary);
    ensureTool('faketool', 'linux-x64', opts);
    expect(execFileSync('cat', [victim], { encoding: 'utf8' })).toBe(
      'untouched',
    );
  });

  it('re-downloads when the cached archive no longer matches', () => {
    const archive = fakeRelease();
    const cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const manifest = manifestFor(archive, sha256(archive));
    const opts = { manifest, cacheDir, ...testOnly };

    const binary = ensureTool('faketool', 'linux-x64', opts);
    const cached = join(cacheDir, readdirSync(cacheDir)[0], 'download.tar.gz');
    writeFileSync(cached, 'corrupted');
    expect(ensureTool('faketool', 'linux-x64', opts)).toBe(binary);
    expect(sha256(cached)).toBe(sha256(archive));
  });

  it('refuses file:// URLs without the test-only option', () => {
    const archive = fakeRelease();
    const cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const manifest = manifestFor(archive, sha256(archive));
    expect(() =>
      ensureTool('faketool', 'linux-x64', { manifest, cacheDir }),
    ).toThrow(/url must be https \(got file:\)/);
    expect(readdirSync(cacheDir)).toEqual([]);
  });
});

describe('assertSafeEntry', () => {
  const tool = { version: '1.0.0', binary: 'faketool' };
  const entry = { url: 'https://example.com/t.tar.gz', sha256: 'a'.repeat(64) };

  it('accepts an https URL with a 64-hex sha256', () => {
    expect(assertSafeEntry('t', tool, entry)).toBe('https:');
  });

  it.each([
    ['http://example.com/t.tar.gz', /url must be https/],
    ['ftp://example.com/t.tar.gz', /url must be https/],
    ['file:///tmp/t.tar.gz', /url must be https/],
    ['not a url', /not a valid URL/],
  ])('rejects url %s', (url, message) => {
    expect(() => assertSafeEntry('t', tool, { ...entry, url })).toThrow(
      message,
    );
  });

  it.each(['', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), undefined])(
    'rejects sha256 %j',
    (hash) => {
      expect(() =>
        assertSafeEntry('t', tool, { ...entry, sha256: hash }),
      ).toThrow(/sha256 must be 64/);
    },
  );

  it.each(['../faketool', 'bin/faketool', '.hidden', ''])(
    'rejects binary name %j',
    (binary) => {
      expect(() => assertSafeEntry('t', { ...tool, binary }, entry)).toThrow(
        /plain file name/,
      );
    },
  );

  it('rejects a version that could escape the cache directory', () => {
    expect(() =>
      assertSafeEntry('t', { ...tool, version: '../../x' }, entry),
    ).toThrow(/x\.y\.z/);
  });
});
