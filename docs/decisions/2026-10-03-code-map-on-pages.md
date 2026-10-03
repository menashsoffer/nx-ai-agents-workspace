# Publish a graphify code map with the site

- Status: accepted
- Date: 2026-10-03

## Context

A browsable map of the code (graphify's graph) is useful next to the site.
No workflow published one before, so nothing had to be retired. The Pages
source is the `gh-pages` branch (ADR 0004): `deploy.yml` replaces everything
on it except `pr-*/`, so any second writer of a path would be overwritten.

## Decision

- `deploy.yml` (push to `main` only, never on PRs) gets a first job,
  `code-map`: `pip install graphifyy==0.9.74` into a throwaway venv,
  `graphify extract . --code-only` and `graphify cluster-only --no-label`
  (AST only: no backend, no LLM, no API key), then
  `.github/scripts/code-map.mjs` writes `index.html`, `graph.json` and
  `vis-network.min.js` as an artifact.
- The `build` job downloads it into `apps/site/public/code-map/`, so Vite
  ships it and `pnpm pages:build` assembles it as part of the site. The map
  lands at `/<repo>/code-map/` through the normal deploy; there is no
  separate publish step.
- graphify's `graph.html` loads `vis-network` from unpkg, which the Pages
  artifact forbids (P1, docs/security.md). `code-map.mjs` fetches the same
  file from the npm tarball, checks it against the SRI hash graphify pins in
  the tag, and rewrites the tag to the local copy. Any other third-party
  asset, a missing tag or a hash mismatch fails the job.
- graphify stays out of `package.json` and the lockfile: pip, CI only.
- `apps/site/public/code-map` is git-ignored; the folder never exists in the
  tree.
- The home page links to `code-map/` ("מפת קוד") in a new tab.

## Consequences

- A graphify release that changes the unpkg tag breaks the job on purpose
  (loud failure instead of a map that loads a CDN script); review
  `code-map.mjs` when bumping the pinned version.
- graphify's own dependencies are not hash-pinned (only `graphifyy` is).
- PR previews have no map: the link there resolves to the production
  `404.html`. The preview workflow is unchanged.
- The map is built from `main` after `ci` and `code-map` both pass; a
  failing `code-map` job blocks the whole deploy.
