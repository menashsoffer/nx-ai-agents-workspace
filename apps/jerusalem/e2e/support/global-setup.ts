import { fileURLToPath } from 'node:url';
import { sqlFile } from './db.ts';

/** Adds the test accounts to the local database (safe to run again). */
export default function globalSetup(): void {
  sqlFile(fileURLToPath(new URL('../seed.sql', import.meta.url)));
}
