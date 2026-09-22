# 0004. Serve Pages from the gh-pages branch so PR previews can live next to production

- Status: accepted
- Date: 2026-09-22

## Context

The multi-agent pipeline (`docs/pipeline.md`) needs a preview URL per pull
request, `https://<owner>.github.io/<repo>/pr-<n>/`, so a human can check an
agent's work before approving. A repo has one Pages site. With the
"GitHub Actions" source (ADR 0003), each deploy replaces the whole site, so
production and previews cannot coexist.

## Decision

- Pages source is **Deploy from a branch: `gh-pages` / (root)**.
- `deploy.yml` publishes `site` at `/` and Storybook at `/storybook/`,
  replacing everything on `gh-pages` **except** `pr-*/`.
- `preview.yml` publishes each PR's `site` build (built with
  `BASE_PATH=/<repo>/pr-<n>/`) to `pr-<n>/` and deletes it when the PR closes.
- Both go through `.github/scripts/gh-pages-publish.sh`, which retries on
  concurrent pushes (they touch disjoint paths).

Supersedes the deployment mechanism in ADR 0003; its base-path and
`404.html` decisions still hold.

## Consequences

- One manual setting change (Settings → Pages → Source).
- `gh-pages` history grows with every deploy. Squash or recreate the
  branch if it gets large.
- Deep links inside a preview hit the root `404.html` (production), since
  Pages serves only one. Previews work from their root URL.
