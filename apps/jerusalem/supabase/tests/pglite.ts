// Runs the Supabase migrations in an isolated PostgreSQL (PGlite). The stub below
// emulates only the parts of Supabase Auth that the migrations use.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_app_meta_data jsonb not null default '{}',
    raw_user_meta_data jsonb not null default '{}',
    created_at timestamptz not null default now()
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth, extensions to anon, authenticated, service_role;
  grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
  -- What production gives every new public table by default (see pg_default_acl).
  alter default privileges in schema public
    grant truncate, references, trigger on tables to anon, authenticated, service_role;
`;

export interface MigrationRange {
  after?: string;
  until?: string;
}

export async function migrationNames(): Promise<string[]> {
  const names = await readdir(MIGRATIONS_DIR);
  return names.filter((n) => n.endsWith('.sql')).sort();
}

export async function applyMigrations(db: PGlite, range: MigrationRange = {}): Promise<void> {
  for (const name of await migrationNames()) {
    if (range.after !== undefined && name <= range.after) continue;
    if (range.until !== undefined && name > range.until) break;
    const sql = await readFile(resolve(MIGRATIONS_DIR, name), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`${name}: ${String(error)}`, { cause: error });
    }
  }
}

export async function emptyDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STUB);
  return db;
}

// With SQL_COVERAGE_DIR set (npm run coverage), each database counts the calls to the
// project's own functions after its migrations ran and writes them to that folder on close.
const FUNCTION_CALLS = `
  select p.oid::regprocedure::text as name, coalesce(s.calls, 0)::int as calls
  from pg_proc p
  left join pg_stat_user_functions s on s.funcid = p.oid
  where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
    and p.prokind in ('f', 'p')
    and not exists (
      select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

async function trackFunctionCalls(db: PGlite, file: string): Promise<void> {
  await db.exec("set track_functions = 'all'");
  const close = db.close.bind(db);
  db.close = async () => {
    await db.exec('reset role');
    await db.query('select pg_stat_force_next_flush()');
    await db.query('select 1');
    const { rows } = await db.query<{ name: string; calls: number }>(FUNCTION_CALLS);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(rows));
    await close();
  };
}

export async function migratedDatabase(range: MigrationRange = {}): Promise<PGlite> {
  const db = await emptyDatabase();
  await applyMigrations(db, range);
  const dir = process.env.SQL_COVERAGE_DIR;
  // A database stopped at an older migration may hold functions a later one drops.
  const prefix = range.until === undefined ? '' : 'partial-';
  if (dir) await trackFunctionCalls(db, resolve(dir, `${prefix}${randomUUID()}.json`));
  return db;
}

// Runs `action` as a signed-in user, or as anon when user is null.
export async function as<T>(db: PGlite, user: string | null, action: () => Promise<T>) {
  const claims = user
    ? JSON.stringify({ sub: user, role: 'authenticated', email: `${user}@example.test` })
    : '{"role":"anon"}';
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  try {
    return await action();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

/**
 * Runs as the database owner with a signed-in user's claims, the way a security definer
 * function (such as submit_supplier_change) calls the functions it uses.
 */
export async function asOwnerFor<T>(db: PGlite, user: string, action: () => Promise<T>) {
  const claims = JSON.stringify({
    sub: user,
    role: 'authenticated',
    email: `${user}@example.test`,
  });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  try {
    return await action();
  } finally {
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

export async function count(db: PGlite, sql: string): Promise<number> {
  const result = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`);
  return result.rows[0]?.n ?? Number.NaN;
}
