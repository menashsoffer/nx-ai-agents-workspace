// Reason keys the server code raises, for the reason-text contract tests.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

async function files(dir: string, ending: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(ending))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.includes('/tests/'));
}

/** Keys the latest server code raises. Older migrations are replaced, so only keys count. */
export async function serverKeys(): Promise<Set<string>> {
  const paths = [
    ...(await files(join(ROOT, 'supabase/migrations'), '.sql')),
    ...(await files(join(ROOT, 'supabase/functions'), '.ts')),
  ];
  const keys = new Set<string>();
  for (const path of paths) {
    for (const match of (await readFile(path, 'utf8')).matchAll(/'reason:([a-z_]+)'/g)) {
      keys.add(match[1] ?? '');
    }
  }
  return keys;
}
