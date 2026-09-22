# 0001. Nx "TS solution" monorepo with pnpm workspaces

- Status: accepted
- Date: 2026-09-22

## Context

The template should give every project the same structure, commands and
guard-rails regardless of which AI assistant is used. Nx 23 offers the legacy
"integrated" layout (tsconfig path aliases, `project.json`) and the newer "TS
solution" layout (pnpm workspaces, TS project references, config in `package.json`).

## Decision

Use the TS solution layout (`create-nx-workspace --preset=react-monorepo
--workspaces`), non-buildable libraries consumed from source, and Nx
configuration inside each project's `package.json`.

## Consequences

- Current Nx default, so `nx migrate` and generators keep working.
- `nx sync` must keep project references in line (`pnpm verify` runs it).
- Libraries need `"workspace:*"` links in the consumer's `package.json`; the
  local generators add them.
