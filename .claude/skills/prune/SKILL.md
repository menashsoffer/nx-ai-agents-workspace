---
name: prune
description: Monthly pruning of the verification setup: review rules, the miss log, the verify stamp log and the verify skill. Use when asked to prune, or once a month.
---

# Monthly prune

Rules and checks only stay useful if the dead ones are removed. Run this once
a month and open one PR with the result. Change nothing under `.github/`
unless the owner asked for it; list such changes in the PR instead.

## Steps

1. **Review rules** (`.github/prompts/review-rules.md`). For each rule, look
   at the last month of PRs and `docs/review-misses.md`: did it ever match?
   List rules that never matched, duplicates, and vague rules. Propose
   deleting or merging them; the owner approves.
2. **Miss log** (`docs/review-misses.md`). Remove rows that a rule now covers.
   A pattern in two or more rows without a rule becomes a rule proposal.
3. **Verify stamp.** Read `.git/verify-stamp.log` (observe mode). Count the
   unstamped commits and pushes. Few or none: propose
   `CLAUDE_VERIFY_STAMP=enforce`. Many: find out why the stamp was missing
   (verify skipped, edits after verify) before enforcing.
4. **Skill and hook.** Re-read `.claude/skills/verify/SKILL.md` and
   `.claude/hooks/stop-verify.sh` against how `pnpm verify` and
   `verify:affected` look now. Fix drift.
5. **Flaky-test deletions.** Check each test deleted for flakiness has a
   reason recorded in `docs/review-misses.md`.

## Output

One PR titled "Monthly prune <YYYY-MM>": what was removed, what was kept and
why, and the stamp decision. Run `pnpm verify:affected` before pushing.
