// Downloads a pinned tool from tools.json, verifies its SHA-256 and caches it
// in <repo>/.security-bin/<tool>-<version>/. A checksum mismatch deletes the
// download and fails; there is never a fallback to an unverified binary.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const securityDir = resolve(fileURLToPath(import.meta.url), '../..');
export const workspaceRoot = resolve(securityDir, '../..');

export function loadManifest(path = join(securityDir, 'tools.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export class ChecksumError extends Error {}

/**
 * @returns {string} absolute path to the verified executable
 */
export function ensureTool(
  name,
  platformKey,
  {
    manifest = loadManifest(),
    cacheDir = join(workspaceRoot, '.security-bin'),
  } = {},
) {
  const tool = manifest.tools[name];
  if (!tool) throw new Error(`Unknown tool "${name}" (not in tools.json).`);
  const entry = tool.platforms[platformKey];
  if (!entry)
    throw new Error(`tools.json has no ${platformKey} build of ${name}.`);

  const dir = join(cacheDir, `${name}-${tool.version}-${platformKey}`);
  const binary = join(dir, tool.binary);
  const archive = join(dir, 'download.tar.gz');
  const stamp = join(dir, '.sha256');
  if (
    existsSync(binary) &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8') === entry.sha256
  ) {
    return binary;
  }

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // curl honours HTTPS_PROXY and retries; available on Linux and macOS.
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', archive, entry.url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const actual = sha256(archive);
  if (actual !== entry.sha256) {
    rmSync(dir, { recursive: true, force: true });
    throw new ChecksumError(
      `Checksum mismatch for ${name} ${tool.version} (${platformKey}):\n  expected ${entry.sha256}\n  actual   ${actual}\nThe download was deleted.`,
    );
  }

  execFileSync('tar', ['-xzf', archive, '-C', dir, tool.binary]);
  chmodSync(binary, 0o755);
  rmSync(archive);
  // Written last: a cached binary counts only if verification completed.
  writeFileSync(stamp, entry.sha256);
  return binary;
}
