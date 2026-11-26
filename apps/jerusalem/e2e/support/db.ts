import { execFileSync } from 'node:child_process';
import { env } from './env.ts';

/** Runs SQL on the local database as its owner and returns psql's unaligned output. */
export function sql(query: string): string {
  return execFileSync('psql', [env('E2E_DB_URL'), '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

export function sqlFile(path: string): void {
  execFileSync('psql', [env('E2E_DB_URL'), '-v', 'ON_ERROR_STOP=1', '-q', '-f', path]);
}

/** A new sign-in account with no profile yet, as after a first Google sign-in. */
export function newAccount(email: string): void {
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
    'authenticated', '${email}', '', now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', '')`);
}
