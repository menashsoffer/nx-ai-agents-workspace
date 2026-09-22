# Conventions

## Naming

| Thing             | Convention                                             | Example                                |
| ----------------- | ------------------------------------------------------ | -------------------------------------- |
| Folders, projects | kebab-case; Nx project name = folder name              | `apps/site`, project `site`            |
| Shared util libs  | `libs/shared/<name>`, project `shared-<name>`          | `libs/shared/utils` → `shared-utils`   |
| Other libs        | `libs/<name>`                                          | `libs/booking`                         |
| Import paths      | `@starter/<project>`                                   | `@starter/ui`, `@starter/shared-utils` |
| Components        | PascalCase file + named export, in a kebab-case folder | `src/lib/date-picker/DatePicker.tsx`   |
| Tests / stories   | next to the file: `Name.spec.tsx`, `Name.stories.tsx`  |                                        |
| Pages             | `src/pages/<Name>Page.tsx`                             | `HomePage.tsx`                         |
| Spikes            | `apps/sandbox/src/spikes/<yyyy-mm>-<slug>/index.tsx`   | `2026-09-hebrew-fonts`                 |
| ADRs              | `docs/decisions/NNNN-short-title.md`                   | `0004-use-zustand.md`                  |

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

## RTL

- `dir`/`lang` are set per app in `index.html`. Libraries never assume a direction.
- Logical utilities only. ESLint (`no-restricted-syntax` in the root config)
  rejects physical ones: `ml/mr/pl/pr/left/right-*`, `text-left/right`,
  `rounded-l/r`, `border-l/r`, `float-left/right`.
- Storybook defaults to RTL; flip the **Direction** toolbar to check LTR.

## Git

- Small commits with an imperative subject line in English ("Add booking form").
- `main` is always deployable; it deploys to Pages on every push.
