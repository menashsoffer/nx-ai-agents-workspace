import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChecksumError, ensureTool, sha256 } from './fetch-tool.mjs';

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

describe('ensureTool', () => {
  it('downloads, verifies and caches a matching archive', () => {
    const archive = fakeRelease();
    const cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const manifest = manifestFor(archive, sha256(archive));

    const binary = ensureTool('faketool', 'linux-x64', { manifest, cacheDir });
    expect(execFileSync(binary, { encoding: 'utf8' })).toBe('fake 1.0\n');
    // cached: a second call works without the source archive
    execFileSync('rm', [archive]);
    expect(ensureTool('faketool', 'linux-x64', { manifest, cacheDir })).toBe(
      binary,
    );
  });

  it('rejects a checksum mismatch and leaves nothing behind', () => {
    const archive = fakeRelease();
    const cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const manifest = manifestFor(archive, '0'.repeat(64));

    expect(() =>
      ensureTool('faketool', 'linux-x64', { manifest, cacheDir }),
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
});
