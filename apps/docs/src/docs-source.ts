import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocEntry } from './sidebar.ts';

/** Every `.md` file under `directory`, one folder deep (`docs/` and `docs/decisions/`). */
export function readDocEntries(directory: string): DocEntry[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.md'))
    .map((dirent) => {
      const file = join(dirent.parentPath, dirent.name);
      return {
        path: file.slice(directory.length + 1).replaceAll('\\', '/'),
        content: readFileSync(file, 'utf8'),
      };
    });
}
