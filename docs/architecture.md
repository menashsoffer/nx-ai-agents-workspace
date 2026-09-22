# Architecture

## Shape

```
            ┌────────────── scope:product ──────────────┐   ┌──── scope:dev ────┐
 apps       │  site  ◄── site-e2e (Playwright)           │   │  sandbox          │
            └──────┬─────────────────────────────────────┘   └───┬───────────────┘
                   │ imports                                      │ imports
            ┌──────▼──────────────── scope:shared ────────────────▼───────────────┐
 libs       │  ui (type:ui, Storybook) ──► shared-utils (type:util)               │
            └─────────────────────────────────────────────────────────────────────┘
 tools         vite-config (every app's vite.config)   workspace-plugin (pnpm new:*)
```

- **Apps** are thin: routing, pages, and composition. Anything reusable moves
  into a lib.
- **`ui`** is the design system: presentational components, Tailwind tokens
  (`src/styles.css`), and Storybook. It has no app logic, no data fetching and
  no routing.
- **`shared-utils`** is plain TypeScript with no React and no DOM, so it can be
  used anywhere (including Node scripts).
- **Feature libs** (`pnpm new:lib x --type=feature`) are where logic shared by
  several apps goes. None exist yet; create one when a second app needs the same
  feature.
- **`sandbox`** is for spikes. Code there can import anything, but nothing may
  import from it. Promote a spike by moving its code into a lib or app, then
  delete the spike.

## Build and runtime

- Every app is a static Vite SPA. `tools/vite-config` sets the common config:
  React, Tailwind v4, Vitest (jsdom), `base` from `BASE_PATH`, and a
  `404.html` fallback for GitHub Pages deep links.
- Libraries are **not built**. Their `package.json` `exports` point at
  `src/index.ts`, and apps consume that source through pnpm workspace links,
  so there is no library build step or `dist` to keep in sync.
- TypeScript uses project references (`tsconfig.json` at each level). `nx sync`
  keeps them in line with `package.json` dependencies.

## Deployment

A single GitHub Pages site per repo (`https://<user>.github.io/<repo>/`):

| Path          | Content                          |
| ------------- | -------------------------------- |
| `/`           | `apps/site` production build     |
| `/storybook/` | `libs/ui` Storybook static build |

See `.github/workflows/deploy.yml`. `sandbox` is never deployed.
