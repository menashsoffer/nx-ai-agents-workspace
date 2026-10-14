# Pipeline engine as pinned reusable workflows

- Status: accepted
- Date: 2026-10-13

## Context

The issue-to-PR pipeline lived only inside this repository: its workflows
check out this repository and assume it is the one being changed. Running it
for another repository meant copying the workflows, scripts and prompts,
which drift and must each be reviewed again.

## Decision

The plan, develop and publish stages are also exposed as reusable workflows
(`engine-plan.yml`, `engine-develop.yml`, `engine-publish.yml`,
`workflow_call`). A target repository calls them from a thin connector,
pinned to a full engine commit. The engine verifies that pin at runtime from
GitHub's OIDC claims, checks the engine and the target out separately, and
takes the target's identity from the workflow context only. The agent jobs
hold read-only tokens; publishing is deterministic and happens in a separate
workflow after fresh re-checks. The new code lives in new files
(`.github/scripts/engine*.mjs`) and imports `pipeline-lib.mjs` without
changing it, so the split tracked in issue #99 is not affected. This
repository's own pipeline workflows stay as they are.

## Consequences

- A target upgrades the engine by changing one commit in its connector.
- The engine and this repository's pipeline share `pipeline-lib.mjs`, so a
  change there reaches targets only when they move their pin.
- The pipeline map (`docs/pipeline-map.md`) lists the engine workflows with
  this repository's stages, although they run in targets.
