# Review misses

What the reviewers (CI, the Claude review, a person) failed to catch, and how
each miss became a rule. The rules live in
`.github/prompts/review-rules.md`, which
the reviewer reads from the default branch, never from the PR.

## How a miss becomes a rule

1. Record every revert, owner-rejected change or bug found after merge below.
2. A pattern becomes a rule when it appears in **at least two** entries and a
   reader can see its trigger in a diff.
3. Propose the rule in a PR that changes `review-rules.md`. The owner reviews
   and approves it. One check per rule; a vague rule is dropped.
4. Prune on a routine (monthly): delete rules that never matched, merge
   duplicates, and remove misses a rule now covers.

Flaky tests get the same treatment: no skip, sleep or retry. Find the root
cause, or delete the test and record why here.

## Log

| Date       | Change                 | What was missed                                                                                                                                                                                                                                                                                                                                                                                    | Rule                                                                                                            |
| ---------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-11-26 | PR #141 (privacy leak) | The run summary copied free-text SDK fields (`result`, `errors[]` text) and enum fields (`subtype`, `stop_reason`, `terminal_reason`) verbatim, so private text or a registered secret could reach the output. Fixed in a5697d4: only `error_count` is kept, enum fields are allowlisted with an `[unrecognized]` placeholder, `api_error_status` is numeric only, and both leak paths have tests. | Copying external or SDK response fields into logs or a summary needs an allowlist and a leak test (provisional) |

Provisional until a second miss confirms the pattern.
