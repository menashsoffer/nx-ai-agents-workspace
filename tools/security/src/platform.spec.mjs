import { describe, expect, it } from 'vitest';
import { detectPlatform, unsupportedMessage } from './platform.mjs';

describe('detectPlatform', () => {
  it.each([
    ['linux', 'x64', 'linux-x64'],
    ['linux', 'arm64', 'linux-arm64'],
    ['darwin', 'x64', 'darwin-x64'],
    ['darwin', 'arm64', 'darwin-arm64'],
  ])('%s/%s -> %s', (platform, arch, key) => {
    expect(detectPlatform({ platform, arch, glibc: '2.39' })).toEqual({ key });
  });

  it('rejects musl Linux (no glibc runtime)', () => {
    const result = detectPlatform({
      platform: 'linux',
      arch: 'x64',
      glibc: undefined,
    });
    expect(result).toEqual({
      unsupported: expect.stringContaining('linux-x64-musl'),
    });
  });

  it('rejects native Windows and points to WSL2', () => {
    const result = detectPlatform({ platform: 'win32', arch: 'x64' });
    expect(result).toEqual({ unsupported: expect.stringContaining('WSL2') });
  });

  it('rejects other architectures', () => {
    expect(
      detectPlatform({ platform: 'linux', arch: 'ia32', glibc: '2.39' }),
    ).toHaveProperty('unsupported');
  });

  it('says clearly that checks did not run', () => {
    expect(unsupportedMessage('win32-x64.')).toMatch(
      /NOT run\. CI is authoritative/,
    );
  });
});
