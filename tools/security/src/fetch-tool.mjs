// Downloads a pinned tool from tools.json, verifies its SHA-256 and caches the
// verified archive in <repo>/.security-bin/<tool>-<version>-<platform>/. Every
// call re-hashes the cached archive and re-extracts the binary from it, so a
// tampered cache is never executed. A checksum mismatch deletes the download
// and fails; there is never a fallback to an unverified binary.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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

const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const BINARY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Throws unless the manifest entry is safe to download and unpack: an https
 * URL (file: only with `allowFileUrls`, for tests), a 64-hex sha256, an x.y.z
 * version and a plain binary name (no path separators).
 */
export function assertSafeEntry(
  name,
  tool,
  entry,
  { allowFileUrls = false } = {},
) {
  const where = `tools.json ${name}`;
  if (!VERSION.test(tool.version ?? ''))
    throw new Error(`${where}: version must be x.y.z.`);
  if (!BINARY.test(tool.binary ?? ''))
    throw new Error(`${where}: binary must be a plain file name.`);
  let protocol;
  try {
    protocol = new URL(entry.url).protocol;
  } catch {
    throw new Error(`${where}: url is not a valid URL.`);
  }
  if (protocol !== 'https:' && !(allowFileUrls && protocol === 'file:'))
    throw new Error(`${where}: url must be https (got ${protocol}).`);
  if (!SHA256.test(entry.sha256 ?? ''))
    throw new Error(`${where}: sha256 must be 64 lowercase hex chars.`);
  return protocol;
}

/** Extracts the binary from an archive whose hash was just verified. */
function extract(archive, dir, binary) {
  const path = join(dir, binary);
  // Unlink first so a planted symlink can't redirect the write.
  rmSync(path, { force: true });
  execFileSync('tar', ['-xzf', archive, '-C', dir, binary]);
  chmodSync(path, 0o755);
  return path;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.allowFileUrls] test-only: accept file:// URLs
 * @returns {string} absolute path to the verified executable
 */
export function ensureTool(
  name,
  platformKey,
  {
    manifest = loadManifest(),
    cacheDir = join(workspaceRoot, '.security-bin'),
    allowFileUrls = false,
  } = {},
) {
  const tool = manifest.tools[name];
  if (!tool) throw new Error(`Unknown tool "${name}" (not in tools.json).`);
  const entry = tool.platforms[platformKey];
  if (!entry)
    throw new Error(`tools.json has no ${platformKey} build of ${name}.`);
  const protocol = assertSafeEntry(name, tool, entry, { allowFileUrls });

  const dir = join(cacheDir, `${name}-${tool.version}-${platformKey}`);
  const archive = join(dir, 'download.tar.gz');
  if (existsSync(archive) && sha256(archive) === entry.sha256) {
    return extract(archive, dir, tool.binary);
  }

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // curl honours HTTPS_PROXY and retries; available on Linux and macOS.
  // --proto/--proto-redir stop a redirect from downgrading the transport.
  const proto = `=${protocol.slice(0, -1)}`;
  execFileSync(
    'curl',
    [
      '-fsSL',
      '--proto',
      proto,
      '--proto-redir',
      proto,
      '--retry',
      '3',
      '-o',
      archive,
      entry.url,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );

  const actual = sha256(archive);
  if (actual !== entry.sha256) {
    rmSync(dir, { recursive: true, force: true });
    throw new ChecksumError(
      `Checksum mismatch for ${name} ${tool.version} (${platformKey}):\n  expected ${entry.sha256}\n  actual   ${actual}\nThe download was deleted.`,
    );
  }
  return extract(archive, dir, tool.binary);
}
