# Nx AI-agents workspace template

A GitHub template for Hebrew-first (RTL) static React sites, built so that any
AI coding assistant works the same way in every project. The conventions live
in the repo itself: [`AGENTS.md`](AGENTS.md), enforced lint rules, and
generators.

**Stack:** Nx 23 · pnpm · TypeScript 6 · React 19 · Vite 8 · React Router 8 ·
Tailwind CSS v4 · Vitest · Playwright · Storybook 10 · GitHub Pages.

## What you get

| Path                     | What                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| `apps/site`              | The product. Hebrew RTL shell, deployed to Pages at `/`                     |
| `apps/site-e2e`          | Playwright tests for `site`                                                 |
| `apps/sandbox`           | Throwaway experiments, one auto-listed page per spike                       |
| `libs/ui`                | Design system: components + Tailwind tokens + Storybook (`/storybook/`)     |
| `libs/shared/utils`      | Framework-free helpers                                                      |
| `tools/vite-config`      | One shared Vite/Vitest config for every app (Pages base path, 404 fallback) |
| `tools/workspace-plugin` | `pnpm new:*` generators that apply the conventions                          |
| `docs/`                  | Architecture, conventions, decision records                                 |

Guard-rails: module-boundary tags (product code can't import dev helpers), an
ESLint rule that rejects non-RTL-safe Tailwind classes (`ml-4`, `text-right`,
...), and a single `pnpm verify` gate that humans, AI agents and CI all run.

## Start a new project

1. On GitHub, click **Use this template** and create the repo.
2. Clone it, then:

   ```sh
   corepack enable            # uses the pnpm version pinned in package.json
   pnpm install
   pnpm template:init --scope my-project   # renames @starter/* → @my-project/*
   ```

3. Fill in **This project** at the top of `AGENTS.md` and set the title in
   `apps/site/index.html`.
4. GitHub → **Settings → Pages → Source: Deploy from a branch**, branch
   `gh-pages`, folder `/ (root)`. Every push to `main` then verifies and
   deploys to `https://<user>.github.io/<repo>/`; PR previews live under
   `/pr-<n>/`.
5. Optional: set up the multi-agent issue → PR pipeline, see
   [`docs/pipeline.md`](docs/pipeline.md).

Requires Node 22+ (see `.nvmrc`).

## Daily commands

```sh
pnpm dev                    # site on http://localhost:4200
pnpm storybook              # components on http://localhost:6006 (RTL/LTR toggle)
pnpm nx dev sandbox         # experiments on http://localhost:4201
pnpm verify                 # everything: sync, format, lint, typecheck, test, build
pnpm e2e                    # Playwright against the production build

pnpm new:app <name>         # new app in apps/ (--scope=product for shipped apps)
pnpm new:lib <name> --type=util|ui|feature
pnpm new:component <name>   # in libs/ui (or --project=<lib>)
pnpm new:spike <name>       # new sandbox experiment
```

## AI assistants

| Tool           | Reads                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| Claude Code    | `CLAUDE.md` → imports `AGENTS.md`; `.claude/settings.json` (Nx plugin, SessionStart hook) |
| OpenAI Codex   | `AGENTS.md`; `.codex/config.toml` (Nx MCP)                                                |
| GitHub Copilot | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/skills/`                         |
| Gemini CLI     | `AGENTS.md` via `.gemini/settings.json` (`contextFileName`), Nx MCP                       |
| Grok Build     | `AGENTS.md` (native)                                                                      |

Edit rules in **`AGENTS.md` only**; the other files just point to it. Nx
maintains its own block at the end of `AGENTS.md` and the skills in
`.agents/skills/` and `.github/skills/`; refresh them with
`pnpm nx configure-ai-agents`.

## Updating the template later

Projects are snapshots of the template. To upgrade a project's Nx and plugins:

```sh
pnpm nx migrate latest && pnpm install && pnpm nx migrate --run-migrations
```

The generators live in `tools/workspace-plugin`. They are designed so they can
later be published to npm and shared across projects.
