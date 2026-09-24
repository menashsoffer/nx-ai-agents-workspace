# AGENTS.md

Single source of truth for every AI coding assistant working in this repo
(Claude Code, Codex, Copilot, Gemini, Grok, ...). Tool-specific files only
point here. Humans: see `README.md` and `docs/`.

## This project

> **Agents:** if a field below still says `_TODO_`, ask the user for it
> before doing any project-specific work. Never invent or guess it.
> (`pnpm template:init` fills these in when a project is created.)

- **What:** _TODO_
- **Live:** _TODO_
- **Language/direction:** Hebrew, RTL

## Stack

Nx 23 monorepo · pnpm workspaces · TypeScript 6 · React 19 · Vite 8 ·
React Router 8 · Tailwind CSS v4 · Vitest · Playwright · Storybook 10.
Static sites only: no server, no SSR. Deployed to GitHub Pages.

## Layout

```
apps/
  site/            the product (scope:product), deployed to Pages at /
  site-e2e/        Playwright tests for site
  pages-e2e/       Playwright tests of the assembled GitHub Pages artifact (base path, 404.html, Storybook)
  sandbox/         throwaway experiments (scope:dev), one folder per spike in src/spikes/
libs/
  ui/              design system: React components + Tailwind tokens + Storybook (deployed at /storybook/)
  shared/utils/    framework-free TS helpers (@starter/shared-utils)
tools/
  vite-config/     defineAppConfig(): shared Vite/Vitest config for every app
  workspace-plugin/ local Nx generators (pnpm new:*)
  pages/           assembles + serves the Pages artifact (site at /, Storybook at /storybook/)
  security/        `pnpm security`: audit, exceptions, AI-config checks, pinned scanners
  pipeline-map/    generates docs/pipeline-map.md from the pipeline workflows (`pnpm pipeline:map`)
  scripts/         one-off repo scripts (template-only; removed by template:init)
docs/              architecture, conventions, decisions (ADRs); read before big changes
                   pipeline.md: the issue → PR multi-agent pipeline
```

If you are running inside the pipeline (`.github/workflows/`), your prompt
in `.github/prompts/` is authoritative for your step. Never edit `.github/`,
`CODEOWNERS`, `.claude/`, `.gemini/`, `.codex/`, `.pipeline/`, `tools/security/`,
`.npmrc` or `.gitmodules` there; such patches are rejected. Package manifests,
the lockfile, `pnpm-workspace.yaml`, `tools/workspace-plugin/` and
`tools/pipeline-map/` only as the plan lists them: the branch is then pushed
with no PR and the owner approves it first (see "Protected files" below).

## Commands

Always run tasks through pnpm/Nx, never `npx vite`, `npx vitest`, etc.

| Task                                   | Command                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| Dev server (site)                      | `pnpm dev` (http://localhost:4200)                         |
| Any app                                | `pnpm nx dev <app>`                                        |
| Storybook                              | `pnpm storybook` (http://localhost:6006)                   |
| **Verify (required before finishing)** | `pnpm verify`                                              |
| Faster verify on changed projects only | `pnpm verify:affected`                                     |
| Unit tests for one project             | `pnpm nx test <project>`                                   |
| E2E                                    | `pnpm e2e`                                                 |
| E2E of the deployed artifact           | `pnpm e2e:pages`                                           |
| Security gates                         | `pnpm security`                                            |
| Regenerate the pipeline map            | `pnpm pipeline:map`                                        |
| Format                                 | `pnpm format`                                              |
| New app / lib / component / spike      | `pnpm new:app` · `new:lib` · `new:component` · `new:spike` |

Project names are short: `site`, `site-e2e`, `pages-e2e`, `sandbox`, `ui`,
`shared-utils`, `vite-config`, `workspace-plugin`, `pages`, `security`, `pipeline-map`. List them with `pnpm nx show projects`.

## Definition of done

1. `pnpm verify` passes (sync, format check, unused-dependency check, lint,
   typecheck, test, build on all projects).
2. New behavior has a test next to the code (`*.spec.ts(x)`); UI components also have a story.
3. If you changed routes or user-visible flows in `site`, `pnpm e2e` passes; if
   you changed routing, assets, the base path or Storybook, `pnpm e2e:pages` too.
4. If you changed dependencies, workflows, or anything in `.claude/`,
   `.gemini/`, `.codex/` or `tools/security/`, `pnpm security` passes.
   **Exit code 2 means the checks were NOT run** (unsupported platform). Say so
   in your summary; never report it as passing. CI is authoritative.
5. If you made an architectural decision, add a short ADR in `docs/decisions/`.

Never finish with a failing `verify`, and never "fix" it by disabling a lint
rule, skipping a test, or loosening a tsconfig.

## Rules

### Creating things

- **Use the workspace generators, not stock Nx ones.** `pnpm new:app`,
  `pnpm new:lib`, `pnpm new:component`, `pnpm new:spike` (see
  `tools/workspace-plugin/README.md`). They apply tags, shared Vite config, RTL
  shell and dependencies that `@nx/react:*` does not. Add `--dry-run` first if
  unsure.
- Nx config lives in each project's `package.json` under `"nx"`. Do not add
  `project.json` files.
- Workspace packages depend on each other with `"workspace:*"` in the
  consumer's `package.json`. Run `pnpm install` after changing dependencies.

### Where code goes

| You are writing...                         | Put it in                                         |
| ------------------------------------------ | ------------------------------------------------- |
| A reusable, presentational React component | `libs/ui` (`pnpm new:component <name>`)           |
| A pure TS helper (no React/DOM)            | `libs/shared/utils`                               |
| A page or app-specific component           | `apps/<app>/src/pages` or `src/components`        |
| Feature logic shared by several apps       | a `feature` lib (`pnpm new:lib x --type=feature`) |
| An experiment / "does this work?"          | `pnpm new:spike <name>` (sandbox)                 |

Module boundaries are enforced by ESLint via tags in `package.json`:

- `scope:product` (site) may use only `scope:product` and `scope:shared`, never `scope:dev`.
- `type:util` depends only on `type:util`; `type:ui` only on `ui`/`util`.
- Import other projects only through their package name (`@starter/ui`),
  never with relative paths across project folders or into `src/lib/...`.

### RTL and Hebrew

- Every app's `index.html` has `<html lang="he" dir="rtl">`. Direction is per
  app; components must work in both directions.
- **Logical Tailwind utilities only**: `ms-*`/`me-*`, `ps-*`/`pe-*`,
  `start-*`/`end-*`, `text-start`/`text-end`, `rounded-s-*`/`rounded-e-*`,
  `border-s`/`border-e`. ESLint rejects `ml-*`, `pr-*`, `left-*`,
  `text-right`, and similar. In plain CSS, use `margin-inline-start`,
  `inset-inline-end` and the like.
- Direction-bearing icons (arrows, chevrons) must flip: `rtl:rotate-180`.
- UI text is Hebrew. Code, identifiers, comments and commit messages are English.
- Wrap LTR fragments (code, URLs, English product names) in `dir="ltr"` or
  `<bdi>` when they sit inside Hebrew sentences.
- Check new `ui` components in Storybook with the Direction toolbar set to both RTL and LTR.

### Styling

- Tailwind v4 only; no CSS-in-JS and no other CSS frameworks.
- Design tokens (colors, fonts) live in `libs/ui/src/styles.css` under
  `@theme`. Add tokens there instead of hard-coding hex values.
- Apps import styles once: `@import '@starter/ui/styles.css';` in `src/styles.css`.
- Join conditional classes with `cn()` from `@starter/shared-utils`.

### Routing and deployment

- Routing uses `react-router` (v8) with `<BrowserRouter basename={import.meta.env.BASE_URL}>`.
  Always use `<Link>`/`<NavLink>` for internal links, never raw `<a href="/...">`,
  so the GitHub Pages base path (`/<repo>/`) is respected.
- Public assets: reference them via `import.meta.env.BASE_URL + 'file.png'` or
  import them from `src/`. Never hard-code a leading `/`.
- The base path comes from the `BASE_PATH` env var (set by the deploy
  workflow). A `404.html` copy of `index.html` makes deep links work on Pages.
  Both are handled in `tools/vite-config`; don't reimplement them per app.

### Protected files (security)

Do **not** change these unless the user explicitly asks for that change:
`.github/workflows/`, `.github/dependabot.yml`, `.github/zizmor.yml`, `.claude/settings.json`,
`.claude/hooks/`, `.gemini/`, `.codex/`, the supply-chain settings in
`pnpm-workspace.yaml` (`allowBuilds`, `strictDepBuilds`, `minimumReleaseAge`,
`overrides`), `packageManager` in `package.json`, `tools/security/`,
`tools/workspace-plugin/` (its generators run through pre-approved
`pnpm new:*` commands), and `tools/pipeline-map/` (pre-approved
`pnpm verify` runs it).
Never add exceptions to `tools/security/exceptions.json` on your own. The
rules are in `docs/security.md`.

The pipeline splits the protected paths in two (`APPROVABLE_PATH_PATTERNS`
and `FORBIDDEN_PATH_PATTERNS` in `.github/scripts/pipeline-lib.mjs`):

- **Approvable** by the owner, once, before any PR exists: any
  `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `tools/workspace-plugin/**`, `tools/pipeline-map/**`. A pipeline patch that
  touches only these is pushed to its branch with no PR; the owner reads the
  diff and comments `/approve-protected <sha>`. The approval covers that
  commit only.
- **Never approvable, local session only:** `.github/**`, `CODEOWNERS`,
  `tools/security/**`, `.claude/`, `.gemini/`, `.codex/`, `.pipeline/`,
  `.npmrc`, `.gitmodules`. A patch touching any of them is rejected, whatever
  else is in it.

The supply-chain settings and `packageManager` above stay off limits for
agents even inside an approvable file. See `docs/pipeline.md`,
"Protected-change approval".

### Dependencies

- Add a dependency only when it clearly beats a few lines of code. Prefer
  what's already installed.
- Single-version policy: third-party packages go in the **root**
  `package.json` (`pnpm add -w <pkg>`, or `pnpm add -Dw` for tooling). Project
  `package.json` files list only `workspace:*` links to other projects.
- Every declared dependency must be used (`knip` in `verify`). A package used
  only indirectly (a plugin loaded by config) goes in `knip.ts` with a reason.
- pnpm won't install versions younger than 3 days (`minimumReleaseAge`). If
  the newest release is too fresh, it picks the newest mature one; don't
  work around this.

## Gotchas

- `pnpm verify` runs `nx sync` first to update TS project references. If
  `typecheck` complains that a file "is not listed within the file list of
  project", run `pnpm nx sync`.
- Node 22.18+ is required: `tools/vite-config` is loaded as TypeScript through
  Node's built-in type stripping. Windows: use WSL2.
- TypeScript 6 doesn't load `@types/*` automatically. Add them to a tsconfig's
  `"types"` when needed, e.g. `"node"`.
- Playwright config must not import `@nx/*` (it crashes Nx's native loader
  under ESM). In sandboxes whose preinstalled Chromium doesn't match
  Playwright's version, set `PLAYWRIGHT_CHROMIUM_PATH` to the Chromium binary.
- Nx caches builds. `BASE_PATH` is part of the cache key, so don't pass the
  base path any other way.

## Nx

The section below is managed by Nx (`nx configure-ai-agents`). Where it
conflicts with the rules above, **the rules above win**. In particular, prefer
the `pnpm new:*` generators over stock `@nx/*` generators.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
