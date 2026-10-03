import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocEntry } from './sidebar.ts';

/** Every `.md` file under `dir`, one folder deep (`docs/` and `docs/decisions/`). */
export function readDocEntries(dir: string): DocEntry[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const file = join(e.parentPath, e.name);
      return {
        path: file.slice(dir.length + 1).replaceAll('\\', '/'),
        content: readFileSync(file, 'utf8'),
      };
    });
}
