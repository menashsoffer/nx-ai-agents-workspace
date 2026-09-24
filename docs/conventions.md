# Conventions

## Naming

| Thing             | Convention                                                     | Example                                |
| ----------------- | -------------------------------------------------------------- | -------------------------------------- |
| Folders, projects | kebab-case; Nx project name = folder name                      | `apps/site`, project `site`            |
| Shared util libs  | `libs/shared/<name>`, project `shared-<name>`                  | `libs/shared/utils` → `shared-utils`   |
| Other libs        | `libs/<name>`                                                  | `libs/booking`                         |
| Import paths      | `@starter/<project>`                                           | `@starter/ui`, `@starter/shared-utils` |
| Components        | PascalCase file + named export, in a kebab-case folder         | `src/lib/date-picker/DatePicker.tsx`   |
| Tests / stories   | next to the file: `Name.spec.tsx`, `Name.stories.tsx`          |                                        |
| Pages             | `src/pages/<Name>Page.tsx`                                     | `HomePage.tsx`                         |
| Spikes            | `apps/sandbox/src/spikes/<yyyy-mm>-<slug>/{meta.ts,index.tsx}` | `2026-09-hebrew-fonts`                 |
| ADRs              | `docs/decisions/NNNN-short-title.md`                           | `0004-use-zustand.md`                  |

Prefer named exports. Default exports exist only where a tool requires them
(Storybook meta, lazy-loaded spikes).

## Tags (module boundaries)

Every project has one `type:*` and one `scope:*` tag in `package.json` → `nx.tags`.

| Tag             | Meaning                            | May depend on              |
| --------------- | ---------------------------------- | -------------------------- |
| `type:app`      | deployable app                     | feature, ui, util          |
| `type:e2e`      | Playwright project                 | util                       |
| `type:feature`  | React + logic (pages, state, data) | feature, ui, util          |
| `type:ui`       | presentational React components    | ui, util                   |
| `type:util`     | framework-free TypeScript          | util                       |
| `type:tooling`  | build/dev tooling (`tools/*`)      | (not imported by app code) |
| `scope:product` | ships to users                     | product, shared            |
| `scope:dev`     | internal helpers (sandbox, ...)    | dev, shared, product       |
| `scope:shared`  | usable by everyone                 | shared                     |

The rules live in the root `eslint.config.mjs` (`@nx/enforce-module-boundaries`).

## Sandbox spikes

A spike answers **one question** quickly and then goes away.

| Stage   | What happens                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create  | `pnpm new:spike <slug>` creates `src/spikes/<yyyy-mm>-<slug>/meta.ts` (title + the question, in `description`) and `index.tsx` (the experiment). It appears on the sandbox index automatically. Reusing a slug is an error. |
| Run     | `pnpm nx dev sandbox` (http://localhost:4201). Each spike is lazy-loaded in its own chunk; the build fails if one lands in the main chunk.                                                                                  |
| Verify  | Spikes are linted (including the RTL rule), typechecked and built by `pnpm verify`. They need no tests. A spike that doesn't compile is fixed or deleted, never excluded.                                                   |
| Promote | The question was answered with "yes": move the code into a lib or app (`pnpm new:lib`, `pnpm new:component`), then delete the spike.                                                                                        |
| Delete  | Remove the folder. Nothing else references it; `verify` stays green even with zero spikes.                                                                                                                                  |

Rules: nothing imports from the sandbox (module boundaries enforce it), and
the sandbox is never deployed.

Projects that don't want a sandbox remove it with
`pnpm nx g @nx/workspace:remove sandbox`. `pnpm new:spike` then fails with a
clear "No sandbox app" message.

## RTL

- `dir`/`lang` are set per app in `index.html`. Libraries never assume a direction.
- Logical utilities only. ESLint (`no-restricted-syntax` in the root config)
  rejects physical ones: `ml/mr/pl/pr/left/right-*`, `text-left/right`,
  `rounded-l/r`, `border-l/r`, `float-left/right`.
- Storybook defaults to RTL; flip the **Direction** toolbar to check LTR.

## Dependencies

- Dependabot opens the update PRs (see `.github/dependabot.yml`). It bumps
  `nx` / `@nx/*` versions but never runs `nx migrate`. Nx minors ride in the
  `npm-minor-patch` group; majors get their own `nx` group PR.
- For any Nx bump that has migrations (always check majors), don't merge the
  Dependabot PR as is. Locally run `pnpm nx migrate <version>`, `pnpm install`
  and `pnpm nx migrate --run-migrations`, then `pnpm verify`. Delete
  `migrations.json` and open one PR with the result; close the Dependabot PR.
- Use the exact syntax from the Nx docs for the installed Nx major; check
  `pnpm nx migrate --help` and don't guess flags.

## Git

- Small commits with an imperative subject line in English ("Add booking form").
- `main` is always deployable; it deploys to Pages on every push.
