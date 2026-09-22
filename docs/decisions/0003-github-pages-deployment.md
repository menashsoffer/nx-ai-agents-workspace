# 0003. GitHub Pages project sites with a 404.html SPA fallback

- Status: accepted (deployment mechanism superseded by 0004)
- Date: 2026-09-22

## Context

The sites are static and hosted on GitHub Pages project sites
(`<user>.github.io/<repo>/`) with no custom domain. Pages has no rewrites.

## Decision

- Vite `base` comes from the `BASE_PATH` env var (deploy workflow:
  `/<repo>/`), and the router uses `basename={import.meta.env.BASE_URL}`.
- Each build copies `index.html` to `404.html`, so deep links load the SPA.
- One Pages site per repo: `site` at `/`, Storybook at `/storybook/`.

## Consequences

- Deep links return HTTP 404 status with the right content. That's fine for
  users; for SEO-critical pages, prerendering would be needed later.
- Hard-coded absolute paths (`/img.png`) break under the base path. Use
  `BASE_URL`.
