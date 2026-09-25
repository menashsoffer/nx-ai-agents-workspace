# Pipeline readiness dry run

- Status: report; the readiness gate **FAILED** (see the last line)
- Date: 2026-09-25 (runs from 2026-09-24 23:50Z to 2026-09-25 01:07Z)

## Context

Before feature issues (#30-#33 and new ones) enter the pipeline again, every
path was exercised on the real repo with the real workflows, using throwaway
`[dry-run]` issues #50-#57 created by the owner. Run URLs are
`https://github.com/menashsoffer/nx-ai-agents-workspace/actions/runs/<id>`.

Pre-checks (all on `main`, Node 24.21.0):

| Check                                                                 | Result                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ruleset requires `ci`, `security` (15368), `pipeline/gates` (5038587) | ok; strict up-to-date, thread resolution, code-owner review                                                                                                  |
| Repo variables (names)                                                | `PIPELINE_APP_CLIENT_ID`, `PIPELINE_BOT_LOGIN`, `PIPELINE_OWNER_LOGIN`, `PROJECT_URL` set; `REQUIRE_COPILOT` unset (as intended); **`GEMINI_MODEL` not set** |
| Secrets (names)                                                       | `CLAUDE_CODE_OAUTH_TOKEN`, `GEMINI_API_KEY`, `PIPELINE_APP_PRIVATE_KEY`, `PROJECT_TOKEN`; Dependabot: `GEMINI_API_KEY`, `PIPELINE_APP_PRIVATE_KEY`           |
| Labels vs `STAGES`, board Status options vs `STAGE_STATUS`            | match (compared by hand: `setup-labels.sh` has no `--check` flag)                                                                                            |
| `pnpm verify`, `pnpm security`                                        | pass on `main` (locally an untracked, unformatted file that was not part of this work broke `nx format:check`; it was moved out of the repo)                 |
| Owner to confirm (not checkable here)                                 | Gemini API billing (credit ran out during the run), the App's installation permissions beyond what the workflows request                                     |

## Decision

Nothing to decide here; this records the evidence.

## Results per scenario

| #   | Result                              | Issues / PRs                   | Runs and notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Pass** (after fixes)              | #50, PR #58                    | ONE plan run `36074756381` (spec + plan, auto-approved), develop `36074929786`, CI + security + review clean, no Copilot step. The first attempt was stuck by bug 1 (gates never computed); after the fixes were on `main` the App handed over and converted the draft itself (`36079069512`). The owner updated the branch and merged at 01:06:47Z (`7ab6a23`): PR and issue `stage:done`, board Done for both, branch deleted, `done.yml` `36080582758`. The merged head (`51cbe71`) still had `pipeline/gates` pending, so the merge appears to have used the owner's PR-only bypass. |
| 2   | Pass                                | #51                            | plan `36074756712`: `scope_split`, routed to human, no develop run, no branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3a  | Pass                                | manual PR #63 (see note)       | Top-level `gh pr comment` `/disposition S-413f8e35 ...`: run `36075837639`, recorded 00:04:55, gates went green with no code change after all three were recorded.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3b  | Pass                                | PR #63                         | Prose first, `/disposition` on line 2: run `36075852018`, reply "the command must be the first thing in the comment ..." (not silence). Quote reply (`> ...` then the command): run `36075918386`, recorded.                                                                                                                                                                                                                                                                                                                                                                             |
| 3c  | Pass                                | PR #63                         | Reply inside the finding's inline thread, short form `/disposition false-positive <reason>`: run `36075978261`, recorded, and the bot answered in the thread ("Recorded: see ...").                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | Not tested                          |                                | A non-owner's disposition being rejected (no second account). The fixer ignoring the owner's in-thread reply (unit-tested only: pipeline PRs are always fixed first, so a live test needs a PR the fixer does not skip).                                                                                                                                                                                                                                                                                                                                                                 |
| 4   | Pass                                | PR #63                         | Head `72dda1d` -> `d65d8f2` (evidence lines moved down one line). Same ids `S-413f8e35`, `S-9eba1b2b`, `S-77448ed4` although Gemini re-worded every title; shown under "Already dispositioned", gates back to success with no new disposition (security run `36076256281`, attempt 2). The first re-review had failed on the Gemini credit error (see bugs).                                                                                                                                                                                                                             |
| 5   | Pass (after fixes, one manual step) | #52, PR #59                    | Finding -> `fix-loop:1` -> fix run `36079571523` (`verify` passed) -> new head `03ef378` -> gates pending on the new SHA -> security clean -> success, draft converted. The first fix round (`36075366925`) had failed on bug 2; `/restart fixing` alone did nothing (bug 4), so a trivial commit `c3ff8d1` produced fresh feedback, and the old thread left by the failed round had to be resolved by hand.                                                                                                                                                                             |
| 6   | Pass                                | #56, PR #61                    | Branch pushed with NO PR and no runs on it (`develop` `36074889584`); the request showed the `package.json` and lockfile diff; `/approve-protected 196ba4b13da3` opened the PR with `pipeline/protected-approval` success. A follow-up commit (`252cf26`) put it back to pending with a new request; approving it gave gates success, draft converted, `stage:human-approval`.                                                                                                                                                                                                           |
| 7   | Pass (plan-time gate)               | #57                            | plan `36074756359`: `protected_surface` (not the develop-time `forbidden_path`), routed to human, no branch pushed. The develop-time `forbidden_path` gate is covered by unit tests only.                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | Pass                                | #55, PR #64                    | PR closed without merging: outcome `pr_closed` (`done.yml` `36076279132`), routed to `stage:needs-attention`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 9   | Pass                                | #57                            | Restarts 1/3, 2/3, 3/3 accepted (00:11, 00:12, 00:14); the 4th refused: "Lifetime restart limit (3) reached; close the issue or fix it in a local session." Removing `stage:needs-attention` by hand posted a one-time hint that it does not open a fresh budget, and `/restart` was then refused.                                                                                                                                                                                                                                                                                       |
| 10  | **Fail**                            | #50-#57 qualified at 23:50:59Z | Nothing queues Gemini jobs: every concurrency group is per issue or PR. Four security reviews started within 16 s (`36075305788`, `36075313865`, `36075317084`, `36075324883`, 23:58:02-23:58:18) plus parallel fix runs. No 429 was seen, but at 00:04:46 Gemini answered HTTP 402 "prepayment credits are depleted" (`36075840816`) and reviews failed until about 00:20.                                                                                                                                                                                                              |

Note on scenario 3: on a pipeline PR the fixer runs first and removes the
finding before an owner can disposition it, so dispositions were tested on a
manual PR (#63, opened by the owner, which the fixer skips). Gemini findings on
pipeline PRs are dispositioned in practice only after the fixer could not or
did not clear them.

## Bugs found

| #   | Bug                                                                                                                                                                                                                                                                                                                                                 | Fix                                                                                                                                                                                                                                 | Status                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `approval` crashed for every pipeline PR: `defaultBranch()` called `api('')`, which requested `repos/<owner>/<repo>/` and got 404, so `pipeline/gates` was never computed (runs `36075368940`, `36075430637`).                                                                                                                                      | `apiUrl()` maps an empty path to the repository itself; test with a fake `gh`.                                                                                                                                                      | PR #66, merged; verified live (#58, #59, #61 gates computed).                                                               |
| 2   | Every fix round failed as `verify_failed`: "Apply the patch" moves `.pipeline/trusted` away and the post step of the local `setup` action then cannot find its `action.yml` (run `36075366925`; since `46a22e8`).                                                                                                                                   | Final `if: always()` step restores the checkout; guard test for any job that hides a local action's checkout.                                                                                                                       | PR #66, merged; verified live (`verify` passed in `36079571523`).                                                           |
| 3   | `approval` crashed converting a person's draft PR (`markPullRequestReadyForReview`, "Resource not accessible by integration", found by the owner on #65) and, because the state was never written, repeated the hand-off on every event. After that fix the `!draft` condition would still have repeated it for a draft that stays a draft.         | `shouldMarkReady` (only pipeline-opened drafts), non-fatal conversion, hand-off once per head whatever the draft state; `fix.yml` restore step wipes `.pipeline` first (a planted `action.yml` could otherwise run in a post step). | PR #67, merged; verified live: the App converted the drafts of #58, #59 and #61. The "no repeats" part is unit-tested only. |
| 4   | `/restart fixing` after a fix round that failed before pushing does nothing: the round left its items in `handled`, so the restarted run found no new feedback (`36079107735`: "noop (no new actionable review comments)"), the PR stayed at `stage:fixing` with nothing running, and its old review thread stayed unresolved and blocked the gate. | `resetFixItems`: the restart forgets `handled`, `lastBatch` and the watermark; resolved and dispositioned items are still skipped; test.                                                                                            | This PR; unit-tested, **not exercised live**.                                                                               |

The PR #49 features were exercised live and held: quote reply, misplaced
command answer, in-thread short form with the thread reply, anchored ids across a
rebase.

## Open risks

- **No queue for Gemini (scenario 10).** Parallel reviews and fix runs across
  PRs are unbounded. A single global concurrency group is not a fix: GitHub
  keeps one running and one pending run per group and cancels the rest, so it
  would drop reviews. It needs a real design (a dispatcher or semaphore).
- **Gemini billing.** A 402 during the run stopped every review for about 15
  minutes, and the pipeline reports it as `invalid_output` ("could not be
  parsed") and routes to a human, which hides the cause. `GEMINI_MODEL` is unset,
  so the model is the action's default.
- **A person's draft PR** still gets a `stage:human-approval` label and a
  hand-off comment once per head. Proposed follow-up: gates informational only
  for a person's draft, with re-evaluation when they mark it ready (a new
  trigger in `approval.yml`, a protected file, so it needs its own trigger-safety
  review).
- **Rebases are expensive for protected PRs.** With strict up-to-date and an
  approval bound to one head, every time `main` moves a protected PR needs a new
  `/approve-protected` and a new review (seen on #61).
- **Owner bypass.** #58 was merged while `pipeline/gates` was pending on its
  updated head; the PR-only bypass allows that. Fine as an owner decision, but the
  gate is not enforced for the owner.
- **Untested:** non-owner disposition rejection; the fixer ignoring in-thread
  `/disposition` replies on a live pipeline PR; the develop-time
  `forbidden_path` gate; bug 4's fix and the "no repeats" half of bug 3 live.
- **Noise:** most events start several workflows that immediately skip.

## Cleanup

Issues #51-#57 and PRs #59-#63 were closed with the comment "dry run" (#50
and #58 were closed by the merge, #64 in scenario 8) and all dry-run branches were
deleted. Labels and the board were left alone. #65 (the owner's Knip PR) and #46
were not touched, except that one security review of #65 was re-run by mistake
(clean, harmless).

## Consequences

Feature intake stays paused until the owner signs off on this report. To flip the
gate: decide how Gemini jobs should be limited (or accept parallel jobs and
monitor billing), confirm bug 4's fix on a live PR, and run the two untested
rejection paths if they matter.

**Readiness gate: FAILED** (scenario 10: Gemini jobs are not queued; every other scenario passed after four fixes, with the untested items listed above).
