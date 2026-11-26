/** A setting the browser tests need; `supabase status -o env` prints them without the prefix. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See documentation/e2e-tests-he.md.`);
  return value;
}
