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

| Date       | Change                 | What was missed                 | Rule                                      |
| ---------- | ---------------------- | ------------------------------- | ----------------------------------------- |
| 2026-11-26 | PR #141 (privacy leak) | A privacy leak got past review. | Logging/storage/network row (provisional) |

Owner: fill in the exact cause of the #141 miss; the rule row is provisional
until a second miss confirms the pattern.
