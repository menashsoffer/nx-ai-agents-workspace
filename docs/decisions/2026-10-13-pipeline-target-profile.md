# Target profile and engine policy for the pipeline engine

- Status: accepted
- Date: 2026-10-13

## Context

The engine's prompts and checks assumed this repository: Nx, pnpm, React,
`pnpm verify`, and the protected paths of `pipeline-lib.mjs`. A target with
another stack (or none, like a documentation-only repository) needs the
engine to learn those facts from the target, without letting the target
weaken the engine's own guarantees.

## Decision

A target describes itself in `.github/pipeline-profile.json`, a strict
schema (`engine-profile.mjs`): unknown fields, engine-version overrides and
commands outside a small argv grammar are rejected. The engine fixes a
minimum set of protected paths (`engine-policy.mjs`); the profile can only
add protected paths, an optional writable allowlist and lower or higher
size limits within fixed ranges. Generic prompts (`engine-plan.md`,
`engine-develop.md`) get the validated profile as a trusted section. Built-in
deterministic checks run as engine code, and fail on an empty set. The
profile is always read from the target's base commit, never from the patch.

## Consequences

- A target changes its stack description, commands or paths through a
  reviewed change to a protected file, not through an issue.
- The engine's minimum protected list is the floor for every target; raising
  it is an engine change that reaches targets when they move their pin.
- This repository's own pipeline (`plan.yml`, `develop.yml`) still uses its
  Nx-specific prompts and `pipeline-lib.mjs` rules; its profile documents the
  same facts for the engine.

## Amendment (2026-10-14, after review)

- The size limits are engine ceilings (10 files, 400 changed lines, 400
  lines per file after the patch); a profile can only lower them.
- The universal protected minimum now also covers every `package.json`,
  lockfiles, `pnpm-workspace.yaml`, `.npmrc`/`.yarnrc*`, `.nvmrc` and other
  runtime pins, `AGENTS.md`/`CLAUDE.md` and nested workflow folders.
- Symbolic links, submodules, mode changes and binary content are rejected
  in the patch, and changed files are checked with `lstat` after applying.
- `exact-content` compares each changed file with the task's
  `expected <path>` block, byte for byte.
- The agent's output (JSON, patch, PR title and body) is scanned for
  secrets before anything is published.
- Verification that runs target code (`verify` job) is split from the job
  that writes the attestation (`check` job, engine code only), in the new
  `engine-check.yml`.
