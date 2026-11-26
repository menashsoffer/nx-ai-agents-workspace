---
name: verify
description: Run the change for real and collect evidence before committing or opening a PR. Use after any change to site, libs/ui or routing, and before saying a task is done.
---

# Verify: run the change, don't just test it

`pnpm verify` proves the code builds and the unit tests pass. It does not
prove the feature works. Do both.

## Steps

1. **Cheap checks first.** `pnpm verify:affected` (or `pnpm verify` when
   unsure). Fix every failure before going on.
2. **Run the app.** `pnpm dev` (site, http://localhost:4200). Use the
   pre-installed Playwright Chromium (set `PLAYWRIGHT_CHROMIUM_PATH` if the
   version differs) to open the pages you changed. Take a screenshot and read
   it: Hebrew text, `dir="rtl"`, no overflow, no console errors.
3. **UI components in `libs/ui`:** `pnpm storybook` and check the story in
   both RTL and LTR (Direction toolbar).
4. **E2E.** Changed routes or user-visible flows in `site`: `pnpm e2e`.
   Changed routing, assets, base path or Storybook: also `pnpm e2e:pages`.
   The flows to cover are the ones in `apps/site-e2e/src`.
5. **Report evidence**: which commands ran, pass or fail, and what the
   screenshot showed. Say plainly what you did not run.

## Rules

- **Three rounds, then a human.** If the same check still fails after three
  fix attempts, stop, report the failing check and what you tried. Do not
  keep guessing. (The Stop hook enforces this for `verify:affected`.)
- **Flaky tests:** never skip, add a sleep or retry until it passes. Find the
  root cause. If you cannot, delete the test and write down why in the PR.
- **Never weaken the check** (lint rule, tsconfig, test) to get green.
- Exit code 2 from `pnpm security` means the checks did not run; say so.
- **Verification stamp.** A passing Stop-hook run stamps the exact working
  tree (`.claude/hooks/verify-stamp.sh`). `git commit` / `git push` of a tree
  without a stamp warns (`CLAUDE_VERIFY_STAMP=observe`, the default) or is
  blocked (`enforce`). Edit after verifying and you need to verify again.
