# Running one task through the pipeline

## Running one task through it

1. **New issue → Task.** Fill in goal, acceptance criteria, size, area.
   `inbox.yml` labels it `stage:inbox` and adds it to the Project.
2. **Triage.** If it is ready, add `stage:qualified`.
3. **Spec and plan** (~2 min). One Claude run writes both and the
   workflow posts two comments (`<!-- pipeline:spec -->` and
   `<!-- pipeline:plan -->`). If every [auto-approval check](#spec-and-plan-auto-approval)
   passes, the label moves straight to `stage:planned` and development
   starts. If one fails, the item goes to the router (an unclear issue or
   a plan that is too big goes to you).
4. **Develop** (5 to 30 min). Claude implements on `issue-<n>-<slug>`, runs
   `pnpm verify`, and the workflow opens a **draft PR** linked to the issue.
5. **CI, preview.** `ci` must pass. The preview comment links
   `https://<owner>.github.io/<repo>/pr-<n>/`.
6. **Copilot (optional).** Only with `REQUIRE_COPILOT=true`: with CI green
   and no open threads, the pipeline requests Copilot; its comments are
   review threads for you to resolve (or `/disposition`). Off (the default),
   this step is skipped and the PR goes straight to step 7.
7. **You.** On `stage:human-approval` the PR is marked ready and you are
   requested as code owner. Check the diff and the preview, approve, merge.
   The branch must be up to date with `main` (the ruleset enforces it).
8. **Done.** The issue closes; the PR and the issue get `stage:done` and
   both cards move to Done. If you close the PR without merging instead,
   the issue gets a `pr_closed` note and comes back to you through the
   router.

### When it stops at `stage:needs-attention`

Only the router sets this label. Read the router's latest
`<!-- pipeline:route -->` note on the issue or PR: it says why it stopped,
lists what was tried in each round (with run links) and every open
question in one place. The outcome notes above it have the details. Then
either finish the PR by hand (you are the reviewer anyway), or answer the
questions / fix the cause and restart it. **The only way to restart is the
owner's `/restart` command.** Removing the label or adding a stage label by
hand does not restart anything (see below).

**`/restart`.** On the **issue**, the owner (`PIPELINE_OWNER_LOGIN`, a human
account) posts one comment whose whole body is one line:

```
/restart <qualified|planned> <reason, 10+ characters>
```

| Stage       | What it does                                                                                                       | Must be in `stage:needs-attention` |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `qualified` | spec + plan again: sets `stage:qualified` on the issue (also for an old item stuck in the deprecated `stage:spec`) | the issue                          |
| `planned`   | develop again from the plan already on the issue: sets `stage:planned`                                             | the issue                          |

`restart.yml` checks the command in full: the commenter is the owner and a
human, the comment was not edited (only new comments count), the issue is
open, the issue is in `stage:needs-attention`, and the issue has fewer than
**3** restarts so far. With an open PR on the issue, `qualified` and
`planned` are refused (they would publish nothing): close the PR first. Any
failed check gets one short bot reply and changes nothing. An accepted
restart, in this order:

1. adds one to the issue's **lifetime counter** and appends the attempt
   `{id, at, by, reason, stage}` (`id` = `a<count>-<comment id>`) in the
   issue's `pipeline-state` comment. Only the bot writes it, labels never
   touch it, and it is never decremented or cleared. The state table shows
   `lifetime resets: n/3` and the latest attempt id;
2. appends the route note
   `<!-- pipeline:route restart attempt=<id> count=<n>/3 -->` with the reason
   in a fenced block, on the issue;
3. applies the stage label.

**The limit.** After 3 restarts an issue is parked for good: a 4th
`/restart` gets the reply "Lifetime restart limit (3) reached; close the issue
or fix it in a local session." and changes nothing; the item stays in
`stage:needs-attention`. (This is a two-week trial: the constant is `MAX_LIFETIME_RESETS` in
`pipeline-lib.mjs`.)

**Label edits by hand do not restart anything.** Loop budgets (the router's
caps) are only ever refreshed by `/restart`. If a person
removes `stage:needs-attention`, or adds a stage label while it is set, the
item continues with the budget it already used and its next problem goes
straight back to a human. `restart.yml` posts one note per parking that says
so and points to `/restart`; it does not undo the label edit.

Which stage for which stop:

- spec + plan / develop (`plan`, `develop` problems): `/restart qualified` or
  `/restart planned`;
- approval or CI problems on the PR (`copilot_request_failed`, `ci_failed`): fix
  the cause (a pushed fix starts CI again), remove `stage:needs-attention`
  from the PR by hand (**Pipeline · Approval** leaves a parked PR alone) and
  run **Pipeline · Approval** manually with the PR number; or close the PR
  and `/restart planned`;
- closed PR (`pr_closed`, on the issue): reopen the PR, or `/restart
qualified` / `/restart planned` (re-develop force-pushes its `issue-<n>-`
  branch), or close the issue;
- router: run **Pipeline · Router** manually with the item number to route
  the latest outcome note again (it goes to a human if that note was
  already routed).

**How the budgets follow restarts.** Router caps count the route notes after
the latest `restart` note (`routeWindow`), or every route note when the item
was never restarted. A route to a human neither opens a window nor counts as a
round.

## Spec and plan (auto-approval)

`plan.yml` replaced the old two-stage flow (a spec stage, then a Claude
plan). One read-only Claude run (`plan.md`, JSON schema) returns two
separate artifacts, and a deterministic job posts each as its own bot
comment under the same markers as before (`<!-- pipeline:spec -->`,
`<!-- pipeline:plan -->`), so develop and the pipeline map read
exactly what they used to:

- `spec`: goal, acceptance criteria (each with a `testable` flag), RTL &
  accessibility, test plan, out of scope, assumptions;
- `plan`: approach, changes (`project`, `file`, `change`, estimated `lines`
  per file), tests, risks, definition of done.

Nothing waits for a human. The item moves straight to `stage:planned` only
if **all** of these hold (`evaluatePlanApproval` in `pipeline-lib.mjs`):

| Check                                                                    | On failure                                   |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| Both parts present, every required section non-empty, every change valid | `invalid_output` → re-plan                   |
| Every acceptance criterion non-empty and marked testable                 | `spec_questions` → human                     |
| No planned file is **never approvable** (see below)                      | `protected_surface` → human (hard gate)      |
| The planner reports no need for secrets, CI or infrastructure            | `needs_secrets_ci_infra` → human (hard gate) |
| At most `PLAN_MAX_FILES` (10) files and `PLAN_MAX_LINES` (400) lines     | `scope_split` → human                        |
| The planner reports no instructions embedded in the issue                | `embedded_instructions` → human (hard gate)  |

Planned files that are protected but **approvable** (`package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tools/workspace-plugin/`,
`tools/pipeline-map/`) pass this check. The success outcome note and the plan
comment then say that the owner must approve them before a PR opens ([Protected-change
approval](pipeline.md#protected-change-approval)). Any never-approvable path
(`.github/`, `CODEOWNERS`, `tools/security/`, `.claude/`, `.codex/`,
`.pipeline/`, `.npmrc`, `.gitmodules`) is still `protected_surface`.

The two size limits are constants at the top of the plan section of
`pipeline-lib.mjs`, set for a two-week trial: tune them there. When several
checks fail, the note carries every reason and the highest-priority code
(gates first). The planner may also report a problem itself (`status:
"problem"`); `agent_error` and `invalid_output` are only ever assigned by
the workflow.

**Old items in `stage:spec`.** Nothing sets `stage:spec` or starts a stage
on it any more, so an item that was already there (its spec comment
stays; the Project card stays in **Spec**) does not move by itself. Add
`stage:qualified` to run the combined stage: it takes the old spec as an
earlier version, overwrites both comments and continues to `stage:planned`.
(A plan run that was already in flight when this changed still finishes the
old way.) If the item already has both a spec and a plan comment you trust,
`stage:planned` develops from them as they are. Old
`spec`-stage outcome notes and `respec` route notes still parse: see
[Router](pipeline-router.md#router).
