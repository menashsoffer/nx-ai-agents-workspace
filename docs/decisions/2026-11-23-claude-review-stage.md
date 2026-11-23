# Independent Claude review stage

- Status: accepted
- Date: 2026-11-23

## Context

Since the Gemini stages were removed
([2026-10-03-remove-gemini-stages](2026-10-03-remove-gemini-stages.md)), a
pipeline PR reaches `stage:human-approval` with only CI and an optional
Copilot review. Nothing that did not write the code checks it against the
spec, and an agent tends to praise its own work (issue #154).

## Decision

A new stage, `review.yml`, runs once per head commit of a pipeline PR after
CI succeeds. A Claude run with read-only tools (`Read`, `Glob`, `Grep`), a
read-only token and the prompt `.github/prompts/review.md` compares the diff
with the issue's `pipeline:spec` and `pipeline:plan` comments, and reports at
most 5 findings (requirement, test, correctness, security; never style), each
with a file, a line and a concrete failure scenario.

- The agent never holds a write token. A deterministic `publish` job (App
  token) checks its JSON and posts the findings as review threads (`R-<n>`),
  which the existing thread gate and `/disposition` already handle.
- The head's `pipeline/review` commit status records the run, so a head is
  reviewed once. `pipeline/gates` has a new **Claude review** gate: a
  pipeline PR waits for `pipeline/review` = `success` on its head.
- A clean review posts no threads, only an outcome note `review: clean`; the
  note re-runs `approval.yml`.
- A failed run sets `pipeline/review` = `failure`, appends an outcome note
  (stage `review`) and `stage:routing`; the router hands it to a human. No
  retry loop and no automatic fixing.
- The reviewer does not run `pnpm verify` (the issue suggested it). CI has
  already run it on the same commit, and running PR code in a job that holds
  the OAuth token would break W5 (docs/security.md). For the same reason the
  PR's `.claude/`, `.codex/` and `.mcp.json` are deleted before the agent
  starts.

## Consequences

- Every pipeline PR costs one more Claude run per head, and the hand-off
  waits for it (a few minutes).
- The owner fixes or dispositions each finding; a person still reviews and
  merges.
- A failed review parks the PR for a person, who re-runs **Pipeline ·
  Review** by hand (workflow_dispatch). A head with a successful review is
  never reviewed again, even by hand.
- `pipeline/review` is not a required check of the ruleset: `pipeline/gates`
  already sums it up.
