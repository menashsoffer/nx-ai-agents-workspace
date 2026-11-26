# Instructions for coding agents

Follow `documentation/coding-standards-he.md`. It is binding for all new code. In short:

- Supabase is the core. Schema, RLS and database functions change only through SQL migrations.
  Authorization is enforced in the database, never only in the browser.
- TypeScript for the engine, Edge Functions and the site. Python only for the PDF/Excel
  extraction scripts in `scripts/`.
- Limits: 100-char lines, 300-line files, 50-line functions, complexity 10, depth 3, 3 params.
- Strict TypeScript that Node and Deno run directly: no `enum`, no `any`, `.ts` import
  extensions, `import type` for types, dates as `YYYY-MM-DD` strings.
- Every business rule and every RLS policy has tests. A fixed bug gets a failing test first.
- Run `npm run check` (and `ruff format --check . && ruff check .` for Python) before pushing.
- Code, comments and commit messages in English. User-facing text and `documentation/` in Hebrew.
- Legacy files listed in section 10 of the standards are being replaced; do not extend them.
