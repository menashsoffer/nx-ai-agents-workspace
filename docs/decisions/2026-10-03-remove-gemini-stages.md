# Remove the Gemini stages from the pipeline

- Status: accepted
- Date: 2026-10-03

## Context

Gemini was the agent of two pipeline stages: the security review
(`security.yml`) and the fix loop (`fix.yml`). The pipeline no longer uses any
Google or Gemini service.

## Decision

Both stages are removed, with everything that existed only for them: the two
workflows and prompts, the `stage:reviewing` and `stage:fixing` stages and the
`fix-loop:*` labels, the `fix-adapter`, `fix-reply`, `security-publish` and
`gemini-billing` commands, the router's `retry` target, `/restart fixing`, the
`pipeline/security` status, the HTTP 402 credit exception, the `.gemini/`
config and its security check, and the `GEMINI_API_KEY` and `GEMINI_MODEL`
settings.

Claude (plan, develop) and Copilot (optional review) are unchanged. The flow
after a draft PR opens is now: CI, then `approval.yml` evaluates the gates
(CI, review threads, Copilot when required, protected-file approval) and hands
the PR to a human. `approval.yml` runs when CI completes on a PR (it used to
run on the `pipeline/security` status). `ci-failed.yml` is what is left of
`security.yml`.

## Consequences

- No automated security review and no automated fixing of review comments:
  every review thread is resolved or dispositioned (`/disposition`, Copilot
  threads only) by a person, and the code owner still reviews and merges.
- A PR parked in `stage:needs-attention` is no longer moved on by a green CI
  run. Take it over by hand and run **Pipeline · Approval**.
- Labels and Project Status options that only existed for the removed stages
  are not deleted by any workflow. Delete `stage:reviewing`, `stage:fixing`,
  `fix-loop:1`, `fix-loop:2` and the **Reviewing** and **Fixing** Project
  options in the repo settings, and the `GEMINI_API_KEY` secret (also as a
  Dependabot secret) and the `GEMINI_MODEL` variable.
