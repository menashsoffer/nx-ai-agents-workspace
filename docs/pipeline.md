# Multi-agent pipeline (stage 1)

An issue goes in; a reviewed, previewed, human-approved pull request comes
out. Gemini and Claude do the writing. Deterministic workflows move work
between stages, check every agent output, and hold every token that can
write. **No agent can merge.** Only a code owner's approval on a green PR
unlocks the merge button.

Every stage leaves an **outcome note** (success or problem). A problem goes
to one **router** that decides where the work goes next: re-plan,
re-develop, retry, or a human. Loops are bounded; hard gates always stop
at a human. See [Router](#router).

## The flow

The full map (every stage, workflow, escalation and fix-loop path, plus
computed findings) is generated from the workflows and `pipeline-lib.mjs`:
see **[pipeline-map.md](pipeline-map.md)**. Regenerate it with
`pnpm pipeline:map` after changing a workflow or `pipeline-lib.mjs`;
`pnpm verify` fails while it is stale.

In the map, solid arrows are the fast path: each stage appends a success outcome note
and sets the next label itself. Dashed red arrows: a stage that hits a problem
appends a problem outcome note and sets `stage:routing`; only the router
decides what happens next.

| Stage label               | Set by                                 | Meaning / next step                                                                                                                                                     |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage:inbox`             | `inbox.yml`                            | New issue. A maintainer triages it.                                                                                                                                     |
| `stage:qualified`         | **a human**, `restart.yml`             | Starts the planning agent (`plan.yml`): one Claude run writes the spec **and** the plan. (Also the owner's `/restart qualified`.)                                       |
| `stage:spec`              | _nothing_                              | **Deprecated.** No workflow sets it or starts a stage on it. It stays so old items keep their board column.                                                             |
| `stage:planned`           | `plan.yml`, `restart.yml`              | Spec and plan comments posted and auto-approved (or the owner's `/restart planned`). Starts the develop agent.                                                          |
| `stage:awaiting-approval` | `develop.yml`, `protected-approve.yml` | Protected changes are pushed to a branch with **no PR**; the owner reads the diff and approves or rejects. See [Protected-change approval](#protected-change-approval). |
| `stage:building`          | `develop.yml`                          | Draft PR open (on the issue and the PR). CI runs.                                                                                                                       |
| `stage:reviewing`         | `security.yml`                         | Security review posted on the PR.                                                                                                                                       |
| `stage:fixing`            | `fix.yml`, `restart.yml`               | Fixer is applying review feedback (or the owner's `/restart fixing` gave the PR a fresh fix budget).                                                                    |
| `stage:human-approval`    | `approval.yml`                         | Everything green. A human reviews the PR and the preview, then approves and merges.                                                                                     |
| `stage:routing`           | any step                               | A stage reported a problem in an outcome note. `router.yml` decides the next step.                                                                                      |
| `stage:needs-attention`   | `router.yml`                           | The router handed off. Read its latest `pipeline:route` note and act; only the owner's `/restart` restarts it (3 per issue, lifetime).                                  |
| `stage:done`              | `done.yml`                             | The PR merged. Set on the PR and its issues; terminal. See [When a PR closes](#when-a-pr-closes).                                                                       |
| `fix-loop:1` / `:2`       | `fix.yml`                              | Automated fix rounds used. At most two. Cleared on escalation and at `stage:human-approval`.                                                                            |

From `stage:building` on, the **PR** carries the stage; the issue stays at
`stage:building` until the PR closes. Then both get `stage:done` (merged),
or the issue goes to the router with `pr_closed` (closed without merging).

### When a PR closes

`done.yml` runs on every closed same-repo PR (fork PRs: nothing). It finds
the linked issues from the PR's `closingIssuesReferences`; if there are
none, from the head branch `issue-<n>-<slug>`, and only if issue `<n>`
exists and is open or was closed by this merge. A PR with no linked issue
(Dependabot, manual PRs) is left alone. It never checks out or runs PR
code, and it writes with the pipeline App's token, so its notes are
trusted by the router.

- **Merged:** the PR and every linked issue get `stage:done`; every other
  `stage:*` and every `fix-loop:*` label is removed. The router is not
  involved. The Project cards move to **Done** (set directly by `done.yml`
  when `PROJECT_URL` is set, and again by `project-sync.yml` from the label).
- **Closed without merging:** no code may be silently abandoned. Each
  linked issue that is still open gets an outcome note (stage `pr`,
  problem `pr_closed`, with the PR number and who closed it) and
  `stage:routing`; the router hands it to a human (`stage:needs-attention`).
  An issue is skipped when another open PR is linked to it (a replacement
  PR), or when it is already closed. The closed PR's `stage:*` and
  `fix-loop:*` labels are cleared, so no stage picks it up again; its card
  stays where it was (the Project's built-in "Item closed" workflow moves
  it to Done if enabled).

**Closed items stay done.** `project-sync.yml` ignores stage labels added
to a closed issue or PR, except `stage:done`, so a late label cannot pull a
card out of Done. The router ignores closed issues and PRs (label events
and manual runs); an open issue whose PR was closed still routes.

## Workflows

| Workflow                | Trigger                                                                                | Agent                          | Output                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbox.yml`             | issue opened                                                                           | none                           | `stage:inbox`, Project item in Inbox                                                                                                                                |
| `plan.yml`              | `stage:qualified` added                                                                | Claude (`plan.md`)             | spec + plan comments, `stage:planned` (or an outcome note + `stage:routing`)                                                                                        |
| `develop.yml`           | `stage:planned` added                                                                  | Claude (`develop.md`)          | branch `issue-<n>-<slug>`, draft PR `Closes #n`, `stage:building`; approvable protected changes: branch only, `stage:awaiting-approval`                             |
| `protected-approve.yml` | owner comment on an issue; CI requested on a same-repo PR                              | none                           | `/approve-protected` opens the PR and sets `pipeline/protected-approval`; a new PR head recomputes it (see [Protected-change approval](#protected-change-approval)) |
| `router.yml`            | `stage:routing` added (open issue or PR), or manual                                    | none (optional external brain) | route note, then the target's label (or a `fix.yml` retry dispatch)                                                                                                 |
| `restart.yml`           | owner `/restart` comment on an issue; a person changes `stage:needs-attention` by hand | none                           | lifetime counter + restart route note + stage label (`fixing`: on the PR, then Pipeline · Fix); or one pointer note to `/restart`                                   |
| `ci.yml`                | every PR                                                                               | none                           | **required check `ci`**: format, lint, typecheck, unit, build, e2e (site)                                                                                           |
| `security.yml`          | CI succeeded on a PR                                                                   | Gemini (`security-review.md`)  | PR review, `pipeline/security` status, `stage:reviewing`                                                                                                            |
| `security.yml`          | CI failed on a pipeline PR's head                                                      | none                           | outcome note `ci_failed` + `stage:routing` (router → human)                                                                                                         |
| `fix.yml`               | review submitted, manual, or router retry                                              | Gemini (`fix.md`)              | one fix commit per round, replies on threads                                                                                                                        |
| `approval.yml`          | `pipeline/security` status, review submitted, disposition note, manual                 | none                           | `pipeline/gates` status; optional Copilot review request (`REQUIRE_COPILOT`), then `stage:human-approval` + preview comment                                         |
| `approval.yml`          | CI requested on a same-repo PR                                                         | none                           | `pipeline/gates` = pending on the new head                                                                                                                          |
| `disposition.yml`       | comment created on a PR                                                                | none                           | owner's `/disposition` → resolved threads + record notes (see [Review gates](#review-gates-and-dispositions))                                                       |
| `preview.yml`           | PR opened/updated/closed                                                               | none                           | `https://<owner>.github.io/<repo>/pr-<n>/`, removed on close                                                                                                        |
| `done.yml`              | PR closed                                                                              | none                           | merged: `stage:done` + Project **Done**; unmerged: `pr_closed` note + `stage:routing` on the issue                                                                  |
| `project-sync.yml`      | any `stage:*` label added (closed items: `stage:done` only)                            | none                           | Project **Status** follows the label                                                                                                                                |
| `deploy.yml`            | push to `main`                                                                         | none                           | site at `/`, Storybook at `/storybook/`, keeps `pr-*/` previews                                                                                                     |

Deterministic logic lives in `.github/scripts/pipeline-lib.mjs` (pure,
unit-tested by `pnpm test:pipeline`, which CI runs) and
`.github/scripts/pipeline.mjs` (the CLI the workflows call).

## Guardrails

- **Issue and comment content is data, never instructions.** Workflows wrap
  it in `<untrusted-data>` tags (look-alike tags inside are neutralised),
  and every prompt says so. Titles and bodies never reach a shell through
  `${{ }}`; they pass through env vars and files. The trusted "Run
  context" section accepts only known keys, each with a strict format
  (repo slug, `#<number>`, commit SHA, pipeline branch, prompt version);
  anything else fails the render.
- **Agents hold no write token.** Agent jobs get a read-only `GITHUB_TOKEN`
  and checkouts without persisted credentials. Their output crosses a job
  boundary (a comment body, JSON, or a patch file) and a separate
  deterministic job validates it before anything is written:
  - plan: JSON schema (`--json-schema`) with two parts, `spec` and `plan`, then the
    auto-approval checks below;
  - develop: JSON schema (`--json-schema`), status and `problem` fields decide the outcome;
  - security review: exactly one fenced `json` block, parsed and normalised
    (zero or several blocks fail the review: `pipeline/security` = error,
    outcome note `invalid_output` → router → human); unknown severities
    count as blocking;
  - develop / fix patches: rejected if they touch `.github/`, `CODEOWNERS`,
    `.claude/`, `.gemini/`, `.codex/`, `.pipeline/`, `tools/security/`,
    `.npmrc` or `.gitmodules` (**never approvable**: the `forbidden_path`
    hard gate, a local session changes those), or the execution surface of
    `pnpm` and the pre-approved commands (`package.json` and
    `pnpm-lock.yaml` at any depth, `pnpm-workspace.yaml`,
    `tools/workspace-plugin/`, `tools/pipeline-map/`: **approvable**),
    checked twice. The check reads every header `git apply` uses
    (`diff --git`, rename/copy, `---`/`+++`), decodes git's C-quoted names
    and rejects any patch it cannot parse. A develop patch whose protected
    paths are all approvable is not rejected: it is pushed **without a PR**
    and the owner approves it first ([Protected-change
    approval](#protected-change-approval)). A fix patch never carries
    protected paths. So **agents cannot add or change dependencies, scripts
    or projects on their own**: the owner approves each such change once,
    before any PR exists.
- **Minimal tools.** Security review: Gemini read-only file tools.
  Plan (spec + plan): Claude `Read, Glob, Grep`. Develop: file edits, `pnpm` and local
  `git add/commit` only; no push, `gh`, `curl` or web. Fix: file edits only,
  **no shell**; a separate job with no secrets formats the patch and runs
  `pnpm verify` before the push job.
- **Markers count only from the bot.** Anyone can post a comment containing
  `<!-- pipeline-state -->` or `<!-- pipeline:spec -->`. The scripts match a
  marker comment only if `PIPELINE_BOT_LOGIN` wrote it (the preview comment:
  `github-actions[bot]`), and the plan/develop agents get the spec and plan
  as separate fields taken from the bot's comments, with markers in all
  other text neutralised. Editing the bot's spec comment keeps the bot as
  its author, so that still works.
- **Trusted feedback only.** The fix loop runs only on PRs the pipeline
  opened (author `PIPELINE_BOT_LOGIN`, branch `issue-<n>-<slug>`), and only
  on feedback from the pipeline bot, Copilot, or people whose
  `author_association` is `OWNER`, `MEMBER` or `COLLABORATOR`. Anyone else
  can comment on this public repo; their text never reaches the fixer.
- **Trusted code only.** Workflows triggered by `workflow_run`, `status` or
  reviews load prompts and scripts from the default branch, not from the PR.
  Fork PRs never reach an agent.
- **No merge path for bots.** The ruleset needs a code-owner approval after
  the last push, resolved conversations, and two green, up-to-date status
  checks: `ci` (GitHub Actions) and `pipeline/security` (the security
  review verdict, accepted **only from the pipeline App**, so no other
  token can post a passing one). There are no bypass actors. The pipeline App has no `workflows` or `administration`
  permission. `GITHUB_TOKEN` cannot approve PRs.
- **Bounded loops.** Two automated fix rounds per PR. Router loops per item:
  re-plan 2, re-develop 1, fix retry 1, and 5 routed rounds in
  total (`ROUTER_CAPS`); after that, a human. See [Router](#router).
- **Notes are trusted by author.** The router reads only outcome and route
  notes written by `PIPELINE_BOT_LOGIN`; anyone can comment on a public repo.
- **Pinned supply chain.** Every action is pinned to a commit SHA, with the
  version in a comment.
- **Minimal permissions.** Every workflow sets `permissions: {}` at the top
  and grants per job; App tokens are down-scoped per job.

### The fix-loop adapter

`fix.yml`'s first job is deterministic. On each run it:

1. stops (no-op) unless the PR was opened by the pipeline: author is
   `PIPELINE_BOT_LOGIN` and the head branch is `issue-<n>-<slug>`;
2. reads the `<!-- pipeline-state -->` comment on the PR (created with the PR);
3. collects review comments and review bodies from **trusted sources** (the
   pipeline bot, Copilot, repo owners/members/collaborators) **newer than the state's
   watermark**, skips ones already handled (**deduped by comment id**),
   resolved threads, approved and dismissed reviews, Copilot's summary body, and pipeline
   bookkeeping. Pipeline review bodies count only if marked
   `<!-- pipeline:actionable -->`. Dedupe is by id; the watermark only moves
   past items with a final decision. Resolved threads and empty bodies are
   deferred (the watermark stops before them), so a thread reopened later
   is still picked up. Inline comments count from their review's
   submission time;
4. decides:

   | Labels on the PR | New actionable comments | Action                                                               |
   | ---------------- | ----------------------- | -------------------------------------------------------------------- |
   | any              | none                    | nothing (rerunning is safe)                                          |
   | no `fix-loop:*`  | yes                     | add `fix-loop:1`, run the fixer                                      |
   | `fix-loop:1`     | yes                     | swap to `fix-loop:2`, run the fixer                                  |
   | `fix-loop:2`     | yes                     | clear `fix-loop:*`; outcome note `budget_exhausted` → router → human |

5. records the handled ids, the new watermark and the round's batch
   (`lastBatch`) in the state comment **before** it edits labels or the
   fixer runs, so a crash cannot spend the same round twice (at worst,
   that round's items are dropped).

It does nothing while the PR is in `stage:routing` or
`stage:needs-attention`. When the fixer itself fails, the router may
**retry** once: it dispatches `fix.yml` with `retry: true`, and the adapter
replays `lastBatch` under the current `fix-loop:*` label. A retry never
consumes a new fix round.

The budget resets only when `fix-loop:*` is cleared: by the owner's
`/restart fixing` (two fresh rounds, counted against the issue's lifetime
restarts) and when the PR reaches `stage:human-approval` (so later human
feedback starts at round 1). Escalating keeps `fix-loop:2`, so moving the PR
out of `stage:needs-attention` by hand does not refill it.

After a successful fix, the push job replies on each inline thread and
resolves a thread only if **every** comment in it is from the pipeline bot
or Copilot. A thread a person opened or replied in stays open for them to
resolve.

### Concurrency

Every job has a concurrency group `pipeline-issue-<n>-<step>` or
`pipeline-pr-<n>-<step>`. The step suffix matters: GitHub keeps only one
pending run per group and cancels the rest, so one shared
`pipeline-pr-<n>` group would silently drop CI, preview or review runs.
`fix.yml`'s adapter and `approval.yml` share `pipeline-pr-<n>-state`,
because both update the state comment. `router.yml` uses
`pipeline-item-<n>-router` (issues and PRs share one number space);
`restart.yml` uses `pipeline-issue-<n>-restart` so two `/restart` comments
cannot read the same counter.

## One-time setup

The pipeline workflows react to issue, review, `workflow_run` and `status`
events, which always run the workflow files **on the default branch**.
Nothing happens until these files are on `main`.

1. **Make the repo public** (or use GitHub Pro/Team) so the ruleset is enforced.
2. **Create a GitHub App** for the pipeline (Settings → Developer settings →
   GitHub Apps). Repository permissions: Contents **write**, Issues
   **write**, Pull requests **write**, Commit statuses **write**, Checks
   **read**, Metadata read. No webhook. Install it on this repo only.
   Events made with `GITHUB_TOKEN` do not trigger workflows, so each hand-off
   (label, push, PR, review, status) is made with this App's token.
3. **Secrets and variables** (Settings → Secrets and variables → Actions):

   | Kind     | Name                       | Value                                                                                                                                                                                                                |
   | -------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | variable | `PIPELINE_APP_CLIENT_ID`   | the App's client ID                                                                                                                                                                                                  |
   | secret   | `PIPELINE_APP_PRIVATE_KEY` | the App's private key (PEM)                                                                                                                                                                                          |
   | variable | `PIPELINE_BOT_LOGIN`       | **required**: the App's bot login, e.g. `my-pipeline[bot]`; the only author whose marker comments and notes are trusted                                                                                              |
   | variable | `PIPELINE_OWNER_LOGIN`     | **required for dispositions, protected-change approvals and restarts**: your GitHub login; the only account whose `/disposition`, `/approve-protected`, `/reject-protected` or `/restart` counts. Unset = nobody can |
   | secret   | `CLAUDE_CODE_OAUTH_TOKEN`  | Claude subscription token from `claude setup-token` (Pro/Max); no API billing                                                                                                                                        |
   | secret   | `GEMINI_API_KEY`           | Gemini API key                                                                                                                                                                                                       |
   | variable | `GEMINI_MODEL`             | optional, e.g. a specific Gemini model                                                                                                                                                                               |
   | variable | `PROJECT_URL`              | set by `setup-project.sh`; leave unset to run without a Project                                                                                                                                                      |
   | secret   | `PROJECT_TOKEN`            | classic PAT, `project` scope (App tokens cannot reach user-owned Projects)                                                                                                                                           |
   | variable | `REQUIRE_COPILOT`          | optional: exactly `true` makes a Copilot review a required gate ([Copilot review is optional](#copilot-review-is-optional)); unset or anything else = off                                                            |
   | secret   | `COPILOT_REVIEW_TOKEN`     | only with `REQUIRE_COPILOT=true`: PAT of a user with Copilot code review (Pull requests: write); App token if unset                                                                                                  |
   | variable | `ROUTER_MODE`              | optional: `rules` (default when unset) or `external` ([Router](#router))                                                                                                                                             |
   | variable | `ROUTER_SHADOW`            | optional: `true` records the external brain's pick without using it                                                                                                                                                  |

4. **Labels:** `tools/scripts/pipeline/setup-labels.sh` (re-run it after
   upgrading to add new labels such as `stage:done` or
   `stage:awaiting-approval`; it is idempotent)
5. **Project:** `gh auth refresh -s project && tools/scripts/pipeline/setup-project.sh`,
   then enable the built-in workflows it prints (Item closed → Done,
   Pull request merged → Done, Item reopened → Inbox). Labels are the
   source of truth; `project-sync.yml` moves cards when labels change.
   Dragging a card does **not** change labels. On an existing Project, add
   missing Status options (such as **Routing** or **Awaiting approval**) in
   the Project UI instead
   of re-running the script, which resets every item's Status.
6. **Pages:** Settings → Pages → Source: **Deploy from a branch**, branch
   `gh-pages`, folder `/ (root)`. Production and previews share that branch
   (see [ADR 0004](decisions/0004-gh-pages-branch-for-previews.md)).
7. **Copilot code review** (optional; needs a Copilot licence): enable it for the repo
   (Settings → Copilot → Code review) only if you turn on `REQUIRE_COPILOT`.
8. **Ruleset** (after everything above is merged): `tools/scripts/pipeline/setup-ruleset.sh`.
   It pins `pipeline/security` to the App's ID, found from
   `PIPELINE_BOT_LOGIN` (or pass `PIPELINE_APP_ID=<App ID>`). Re-run it if
   you replace the App.

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
5. **CI, preview, review.** `ci` must pass. The preview comment links
   `https://<owner>.github.io/<repo>/pr-<n>/`. Gemini's security review
   follows. Blocking findings become threads and trigger up to two fix rounds.
6. **Copilot (optional).** Only with `REQUIRE_COPILOT=true`: with CI green,
   the security status clean and no open threads, the pipeline requests
   Copilot, and its comments go through the same fix loop. Off (the default),
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
/restart <qualified|planned|fixing> <reason, 10+ characters>
```

| Stage       | What it does                                                                                                                                                           | Must be in `stage:needs-attention` |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `qualified` | spec + plan again: sets `stage:qualified` on the issue (also for an old item stuck in the deprecated `stage:spec`)                                                     | the issue                          |
| `planned`   | develop again from the plan already on the issue: sets `stage:planned`                                                                                                 | the issue                          |
| `fixing`    | the fix loop of the issue's linked open PR: sets `stage:fixing`, clears its `fix-loop:*` labels (`resetFixLoop`, a fresh budget of two rounds) and runs Pipeline · Fix | the PR (the issue is not parked)   |

`restart.yml` checks the command in full: the commenter is the owner and a
human, the comment was not edited (only new comments count), the issue is
open, the item to restart is in `stage:needs-attention`, and the issue has
fewer than **3** restarts so far. With an open PR on the issue, `qualified`
and `planned` are refused (they would publish nothing): restart the PR with
`fixing`, or close it. Any failed check gets one short bot reply and changes
nothing. An accepted restart, in this order:

1. adds one to the issue's **lifetime counter** and appends the attempt
   `{id, at, by, reason, stage}` (`id` = `a<count>-<comment id>`) in the
   issue's `pipeline-state` comment. Only the bot writes it, labels never
   touch it, and it is never decremented or cleared. The state table shows
   `lifetime resets: n/3` and the latest attempt id;
2. appends the route note
   `<!-- pipeline:route restart attempt=<id> count=<n>/3 -->` with the reason
   in a fenced block, on the item that restarts (the issue, or the PR for
   `fixing`);
3. applies the stage label.

**The limit.** After 3 restarts an issue is parked for good: a 4th
`/restart` gets the reply "Lifetime restart limit (3) reached; close the issue
or fix it in a local session." and changes nothing; the item stays in
`stage:needs-attention`. `/restart fixing` counts against the same 3.
(This is a two-week trial: the constant is `MAX_LIFETIME_RESETS` in
`pipeline-lib.mjs`.)

**Label edits by hand do not restart anything.** Loop budgets (the router's
caps and the fix rounds) are only ever refreshed by `/restart`. If a person
removes `stage:needs-attention`, or adds a stage label while it is set, the
item continues with the budget it already used and its next problem goes
straight back to a human. `restart.yml` posts one note per parking that says
so and points to `/restart`; it does not undo the label edit.

Which stage for which stop:

- spec + plan / develop (`plan`, `develop` problems): `/restart qualified` or
  `/restart planned`;
- fix loop (`budget_exhausted`, `agent_error` that used the retry): `/restart
fixing`. Feedback that arrived while the PR was parked is picked up by the
  Pipeline · Fix run it starts;
- approval or CI problems on the PR (`copilot_request_failed`, `ci_failed`): fix
  the cause. A pushed fix starts CI again, and the next green run starts the
  security review, which moves the PR on by itself. If it stays parked,
  `/restart fixing`, then run **Pipeline · Approval** manually with the PR
  number;
- closed PR (`pr_closed`, on the issue): reopen the PR, or `/restart
qualified` / `/restart planned` (re-develop force-pushes its `issue-<n>-`
  branch), or close the issue;
- router: run **Pipeline · Router** manually with the item number to route
  the latest outcome note again (it goes to a human if that note was
  already routed).

**How the budgets follow restarts.** Router caps count the route notes after
the latest `restart` note (`routeWindow`), or every route note when the item
was never restarted. A route to a human neither opens a window nor counts as a
round. `decideFix` keeps `fix-loop:2` when it escalates, so the fix budget
also stays spent until `/restart fixing` clears it; the other place the fix
budget resets is a PR reaching `stage:human-approval` (later human feedback
starts at round 1).

## Spec and plan (auto-approval)

`plan.yml` replaced the old two-stage flow (a Gemini spec, then a Claude
plan). One read-only Claude run (`plan.md`, JSON schema) returns two
separate artifacts, and a deterministic job posts each as its own bot
comment under the same markers as before (`<!-- pipeline:spec -->`,
`<!-- pipeline:plan -->`), so develop, fix and the pipeline map read
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
approval](#protected-change-approval)). Any never-approvable path
(`.github/`, `CODEOWNERS`, `tools/security/`, `.claude/`, `.gemini/`, `.codex/`,
`.pipeline/`, `.npmrc`, `.gitmodules`) is still `protected_surface`.

The two size limits are constants at the top of the plan section of
`pipeline-lib.mjs`, set for a two-week trial: tune them there. When several
checks fail, the note carries every reason and the highest-priority code
(gates first). The planner may also report a problem itself (`status:
"problem"`); `agent_error` and `invalid_output` are only ever assigned by
the workflow.

**Old items in `stage:spec`.** Nothing sets `stage:spec` or starts a stage
on it any more, so an item that was already there (its Gemini spec comment
stays; the Project card stays in **Spec**) does not move by itself. Add
`stage:qualified` to run the combined stage: it takes the old spec as an
earlier version, overwrites both comments and continues to `stage:planned`.
(A plan run that was already in flight when this changed still finishes the
old way.) If the item already has both a spec and a plan comment you trust,
`stage:planned` develops from them as they are. Old
`spec`-stage outcome notes and `respec` route notes still parse: see
[Router](#router).

## Router

### Outcome notes

Every stage appends one comment per run to the issue (spec, plan,
develop, pr) or PR (security, fix, approval, ci). It is never edited or upserted,
so the history stays readable:

````
<!-- pipeline:outcome stage=plan result=problem problem=spec_questions run=123456 -->
**Plan stopped: the issue is unclear or its criteria are not testable.**

- details, one per line
- Question: questions for the next stage
- Run: https://github.com/<owner>/<repo>/actions/runs/123456

```json
{"v":1,"stage":"plan","result":"problem","problem":"spec_questions","summary":"...","questions":["..."],"details":["..."],"run_url":"...","prompt_version":"plan.md@4","item":22}
```
````

`stage` is one of `spec` (legacy: notes written before spec and plan merged), `plan`, `develop`, `security`, `fix`, `approval`, `ci`, `pr`;
`result` is `success` or `problem`. On success the stage moves to its next
label itself (no extra run). On a problem it sets `stage:routing`.
`pipeline.mjs outcome <n> <file.json>` posts a note; `pipeline.mjs classify
<stage> ...` turns job results and agent output into one. Agent text in a
note is flattened to single lines and cannot contain `<!--`, so it cannot
forge a marker.

### Problem codes (`PROBLEMS`)

| Code                        | Reported by    | Meaning                                                                                                                                                                                                              |
| --------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_output`            | plan, security | The agent answered, but not in the required shape (plan: a required spec or plan section is missing)                                                                                                                 |
| `agent_error`               | plan, dev, fix | The run failed: API/quota/timeout, empty output, no changes                                                                                                                                                          |
| `spec_missing`              | _legacy_       | Old plan-stage note: no spec comment. Still read, no longer written                                                                                                                                                  |
| `spec_questions`            | plan           | The issue is unclear (blocking questions), or a criterion is not testable                                                                                                                                            |
| `untestable_criteria`       | _legacy_       | Old plan-stage note: criteria untestable. Still read, no longer written                                                                                                                                              |
| `verify_failed`             | develop, fix   | `pnpm verify` could not be made green (fix: the secret-free verify job failed on the patch)                                                                                                                          |
| `plan_gap`                  | develop        | The plan is wrong or incomplete                                                                                                                                                                                      |
| `budget_exhausted`          | fix            | Both fix rounds used                                                                                                                                                                                                 |
| `copilot_request_failed`    | approval       | The Copilot review could not be requested (`REQUIRE_COPILOT` on)                                                                                                                                                     |
| `ci_failed`                 | ci             | CI failed on a pipeline PR's current head (`security.yml`'s `ci-failed` job)                                                                                                                                         |
| `pr_closed`                 | pr             | The issue's PR was closed without merging and no other open PR is linked (`done.yml`)                                                                                                                                |
| `protected_surface`         | plan, develop  | **Gate.** The work touches a never-approvable path (`tools/security/`, `.github/`, `CODEOWNERS`, ...) or supply-chain settings                                                                                       |
| `protected_approval_needed` | develop, fix   | **Gate.** develop: the branch is pushed with no PR and the owner is asked (an outcome note, not routed; the issue waits in `stage:awaiting-approval`). fix: the fix patch carries protected paths and was not pushed |
| `protected_rejected`        | develop        | The owner rejected the protected changes (`/reject-protected`). Routes to a human; the branch is kept                                                                                                                |
| `needs_secrets_ci_infra`    | plan, develop  | **Gate.** Needs secrets, CI/workflow changes, infra, a server                                                                                                                                                        |
| `scope_split`               | plan           | Bigger than size L, or over the auto-approval size limits; split the issue (routes to a human)                                                                                                                       |
| `embedded_instructions`     | plan           | **Gate.** The issue contains instructions aimed at the agents                                                                                                                                                        |
| `forbidden_path`            | develop, fix   | **Gate.** `check-patch` rejected the patch: a never-approvable path, or a header it cannot parse                                                                                                                     |

### Rules table (`decideByRules`)

| Stage    | Problem                                                | Target                                                      |
| -------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| spec     | `invalid_output`                                       | re-plan (legacy note; `stage:qualified`)                    |
| spec     | `agent_error`                                          | human: "Gemini call failed (quota?), see run"; no loop used |
| plan     | `agent_error`, `invalid_output`                        | re-plan (`stage:qualified`)                                 |
| plan     | `spec_questions`, `scope_split`                        | human                                                       |
| plan     | `spec_missing`, `untestable_criteria`                  | re-plan (legacy notes only)                                 |
| develop  | `verify_failed`, `agent_error`                         | re-develop (`stage:planned`)                                |
| develop  | `plan_gap`                                             | re-plan (`stage:qualified`)                                 |
| develop  | `protected_rejected`                                   | human (the branch is kept for the owner to decide)          |
| fix      | `agent_error`                                          | retry: `fix.yml` with `retry: true`                         |
| fix      | `budget_exhausted`                                     | human                                                       |
| security | `invalid_output`                                       | human                                                       |
| approval | `copilot_request_failed`                               | human                                                       |
| ci       | `ci_failed`                                            | human (proposed later: one fixer retry with the CI log)     |
| pr       | `pr_closed`                                            | human only; never retried (the close was deliberate)        |
| any      | hard gate, anything unlisted, or no valid outcome note | human                                                       |

There is no re-spec target any more: one stage writes both artifacts.
A leftover `respec` route note in an issue's history is read as a re-plan
(and counts against the re-plan cap), and an old `spec`-stage outcome note
routes by the legacy rows above.

### Caps and hard gates (`clampDecision`)

After any brain decides, `clampDecision` applies, and nothing bypasses it:

- **Hard gates** (`HARD_GATES`) always go to a human, whatever the mode,
  caps or brain.
- The target must be in `allowedTargets(stage, problem)` (that row's
  target, or human).
- **Caps** (`ROUTER_CAPS`): re-plan 2 (shared by every row that re-plans),
  re-develop 1, retry 1, and 5 routed rounds in total per item.
  Rounds are counted from the bot's route notes after the latest `restart`
  note (the owner's `/restart`, see [When it stops](#when-it-stops-at-stageneeds-attention));
  routes to a human do not reset them.
- **Re-develop safety:** `develop.yml` publishes nothing when an open PR
  already exists for the issue's branch, so the router sends that case to
  a human instead.

The router never sets `stage:routing`. With no valid, fresh outcome note by
the bot (none, unparseable, already routed, or a success) it goes to a
human and says why. Every decision appends a route note:

````
<!-- pipeline:route target=replan round=1 -->
**Routed to re-plan (`stage:qualified`), round 1/2, because:** the planner failed or returned invalid output

```json
{"v":1,"from_stage":"plan","problem":"invalid_output","target":"replan","reason":"...","round":1,"cap":2,"mode":"rules","external":null,"questions":["..."]}
```
````

A route to a human also lists what was tried in each round and every open
question, so one comment has the whole story.

### Modes: `ROUTER_MODE` and `ROUTER_SHADOW`

- `rules` (default, also when unset): `decideByRules` decides.
- `external`: `router.yml`'s `brain` job (read-only token, no write
  access) asks an external brain for `{ target, confidence }`. The router
  uses it only if `target` is in `allowedTargets` and `confidence >= 0.8`;
  otherwise the rules decide. `clampDecision` applies either way.
- `ROUTER_SHADOW=true`: the external pick is recorded in the route note
  (`"mode":"shadow"`, `external: {...}`), but the rules decide.

The external brain is a stub today
(`.github/scripts/router-external.mjs` returns `null` and makes no network
call). The intended brain is **Jev** by TypeSafe AI, a "System One"
decision model that returns typed choices with calibrated probabilities
([announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)),
through OpenRouter: `POST https://openrouter.ai/api/alpha/decisions`,
model `typesafe/jev-1.13`, with `state` = the outcome note plus trimmed
history, and one `choice` question whose options are exactly the allowed
targets. It must stay in the `brain` job, which holds no write token. No
key or secret exists for it yet.

### Not automated yet

- **CI failure retry.** `ci_failed` goes to a human. Proposed: one retry
  through the fixer with the CI log as input, then a human.

- **Security retry.** `security` problems go to a human, because
  `security.yml` only runs on `workflow_run` after CI. A retry would need a
  `workflow_dispatch` path in `security.yml` (with the PR number and head
  SHA) that the router could dispatch, as it does for `fix.yml`.

## Review gates and dispositions

The Gemini security review (and the Copilot review, when
[`REQUIRE_COPILOT`](#copilot-review-is-optional) is on) are **required gates on the
PR's head commit**. Every finding is either fixed or explicitly dispositioned
by the repo owner, and one commit status, **`pipeline/gates`**, sums it all up
for that exact SHA. The main ruleset requires it (see the follow-up command in
the PR that added it). This is a two-week trial.

### The gates

`pipeline/gates` is set by the pipeline App (`approval.yml`, `approval`
command; pure logic in `evaluateGates`). For the current head all of these
must hold, checked in this order:

1. **CI**: the `ci` check run succeeded (and the `security` CI job, if it ran).
2. **Gemini security review**: `pipeline/security` is `success`, **or** it is
   `failure` and every blocking finding id in the security outcome note for
   this head has a valid disposition.
3. **Review threads**: no unresolved thread.
4. **Copilot**: it reviewed this head. Only when `REQUIRE_COPILOT` is `true`;
   otherwise this gate is `success` with the detail "not required
   (REQUIRE_COPILOT off)".
5. **`pipeline/protected-approval`**: a pipeline PR that touches protected
   paths needs the owner's approval of this exact head (status `success`,
   recomputed by the `approval` command, not just read back). A PR with no
   protected paths, and any PR the pipeline did not open, gets `success`
   automatically. See [Protected-change approval](#protected-change-approval).

The status is `success` when all hold, `failure` for a real blocker (CI failed,
the reviewer errored, a required approval was refused) and `pending` otherwise,
its description naming the first missing gate. A push gives the new SHA no
status, which blocks the merge; `approval.yml` posts a `pending` one as soon
as CI is requested so the PR says why it waits. When the gates hold, the
existing hand-off happens: `stage:human-approval`, PR marked ready, code
owners requested. Merging stays with a human.

### Copilot review is optional

The Copilot review needs a Copilot licence, so it is **off by default**. The
repo variable `REQUIRE_COPILOT` turns it on, and only the exact string `true`
does: unset, empty, `false`, `TRUE`, `1` or anything else is off (a typo can
never leave `pipeline/gates` pending forever for a review nobody licensed).

- **Off:** the `copilot` gate is `success` ("not required (REQUIRE_COPILOT
  off)"), no review is requested (so `copilot_request_failed` cannot happen)
  and the PR goes to `stage:human-approval` as soon as the other gates hold.
  The state table shows "not required". If Copilot reviews anyway, its threads
  still count as review threads.
- **On:** the review is requested once per head commit after CI, security and
  threads hold, and the hand-off waits until Copilot reviewed that commit.
- **To turn it on:** set the variable `REQUIRE_COPILOT` to `true`, and either
  give the secret `COPILOT_REVIEW_TOKEN` the token of a Copilot-licensed user
  or enable automatic Copilot review for the repo, and enable Copilot code
  review (Settings → Copilot → Code review).

**Why one status:** the ruleset can only require named checks. Requiring
`pipeline/security`, Copilot and thread resolution separately would need a
status for each and would not express "fixed _or_ dispositioned". One bot-set
status bound to the SHA, computed by tested code, is the single thing to
require. Only the App can set it (the ruleset pins its integration id). GitHub has
no workflow trigger for resolving a thread by hand: resolve through
`/disposition`, or re-run **Pipeline · Approval** (Actions → run workflow, PR
number) after resolving one manually.

The bot keeps one **Review gates** comment per PR (`<!-- pipeline:gates -->`,
edited in place): each gate, the open findings with their ids, and the
dispositions on record.

### Finding ids

- Gemini findings: `S-<8 hex>` = first 8 hex of sha256(file, title, detail),
  lower-cased, punctuation and whitespace collapsed. Line, severity and the
  suggested fix are **not** part of it. The id is shown in the review
  comment, in the inline thread's hidden marker and in the security outcome
  note's `details[]` (`head=<sha> blocking=<n>`, then `S-… [severity] file:line title`).
- Copilot findings: `C-<n>`, `n` = database id of the thread's top comment,
  listed in the Review gates comment.

### `/disposition` (owner only)

Post a comment whose **whole body** is one or more lines of exactly:

```
/disposition <finding-id> <accepted-risk|false-positive|out-of-scope> <reason, at least 10 characters>
```

- Every line must be valid, or the comment is rejected as a whole with one
  short bot reply giving the reason. Prose around the command is a rejection.
- Only **new** comments count (`issue_comment: created`); an edit never runs.
- Accepted only from `vars.PIPELINE_OWNER_LOGIN` and only from a `User`
  account. Not `author_association`, not the PR author. Unset variable: nobody.
  Others' comments are ignored without a reply.
- The id must be a blocking finding of the **current head's** security review,
  or an open Copilot thread on the PR.
- On acceptance the bot resolves the finding's review thread (Copilot threads
  and the inline threads the security review opens, so the ruleset's
  thread-resolution requirement is met), then appends one record note per
  finding: `<!-- pipeline:disposition id=… kind=… head=<sha> by=<login> comment=<id> -->`
  with the reason in a fenced block. The notes re-run `approval.yml`.

### How dispositions bind to SHAs

A record names the head the owner saw. Ids are content-based, so **after a
push, a finding that was not fixed has the same id on the new head and is
still covered**: the security review does not open a new thread for it, the
gate counts it as dispositioned, and the fix loop skips it. A finding that is
fixed disappears from the next review (that is "fixed"). A finding the
reviewer re-words enough to change file, title or detail gets a new id and
needs a new decision. Only records made by the owner count, and only the bot's
own notes are read. Limit: Gemini is not deterministic, so an unfixed finding
may come back worded differently; that shows up as a new id, which is safe
(fails toward asking again).

### Fix loop

`fix-adapter` drops findings with a disposition in effect before the fixer
sees them: the bot's inline finding comments, Copilot threads, and the
dispositioned items of an actionable review body. An accepted risk is never
auto-fixed.

## Protected-change approval

A task that needs a dependency, a new app or lib, or a change to a workspace
generator used to dead-end at a hard gate and the owner redid it locally. Now
the owner **approves such a change once, before any PR exists**. This is a
two-week trial.

**Which paths.** `pipeline-lib.mjs` has two lists, and `APPROVABLE_PATH_PATTERNS`
is a strict subset of `FORBIDDEN_PATH_PATTERNS` (a test asserts it):

| Kind                 | Paths                                                                                                                     | What happens                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Approvable**       | any `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tools/workspace-plugin/**`, `tools/pipeline-map/**`         | The owner approves the diff with a command (this section)           |
| **Never approvable** | `.github/**`, `CODEOWNERS`, `tools/security/**`, `.claude/`, `.gemini/`, `.codex/`, `.pipeline/`, `.npmrc`, `.gitmodules` | `forbidden_path` hard gate, exactly as before; a local session only |

A patch that touches **any** never-approvable path stays a hard gate, even
next to approvable ones. Because `.github/**` can never be in a bot-pushed
patch, the pipeline App keeps `contents: write` and never needs the
`workflows` permission.

**Why before the PR.** Package scripts, the lockfile, the generators that
`pnpm new:*` runs and the map tool that `pnpm verify` runs all execute with
repo secrets as soon as a `pull_request` workflow runs on them. So nothing
may run on the branch until the owner has read it: the branch is pushed
**without a PR**, and no workflow may fire on a push to `issue-<n>-<slug>`.
A test (`push guard` in `pipeline-lib.test.mjs`) reads every workflow and
fails if any `on: push` lacks a branch filter that leaves those branches
out, or if any workflow listens to `create`. Today only `deploy.yml` has
`on: push`, limited to `main`.

### The flow

1. **Plan.** `evaluatePlanApproval` lets approvable protected files pass.
   The outcome note and the plan comment say the owner must approve them
   before a PR opens. A never-approvable planned path is still
   `protected_surface`.
2. **Develop.** The implement job runs `check-patch --accept approvable`. If
   every protected path is approvable and the rest of the patch is fine, it
   uploads the patch as artifact `protected-patch` (7 days) and outputs
   `protected=approvable` with the sorted paths; otherwise it is today's
   `forbidden_path`. The publish job downloads it, checks that it is exactly
   the kind implement saw, pushes `issue-<n>-<slug>` and opens **no PR**.
   Then `protected-request` (`pipeline.mjs`):
   - recomputes the protected paths from `main...head` through the API (a
     branch that holds a never-approvable path, or a list of 300+ files that
     may be cut off, is deleted and reported as `forbidden_path`);
   - posts the bot comment `<!-- pipeline:protected-approval head=<sha>
paths=<sha256 of the sorted path list> -->` on the issue: the protected
     paths with their **full diff** (`<details>`; cut only past GitHub's
     comment size limit, with a link to the branch compare view), a summary
     of the other files, the commands `/approve-protected <first 12 hex of
the head>` and `/reject-protected <reason>`, and the proposed PR title
     and body;
   - appends an outcome note (`develop` / `protected_approval_needed`) that
     does **not** set `stage:routing`, and sets `stage:awaiting-approval`.
     The router never moves an item out of that stage.
3. **The owner answers** with a comment on the issue whose whole body is one
   command (`protected-approve.yml`, `issue_comment: created`). It accepts
   only if **all** of these hold, else one short bot reply with the reason and
   no state change:
   - the commenter is `vars.PIPELINE_OWNER_LOGIN` and a `User` (the same
     `checkDispositionAuthor` as `/disposition`; unset variable = nobody);
   - the body is exactly the command, nothing else, and the comment was not
     edited (only `created` events count, and the script re-reads the
     comment);
   - the issue is open and in `stage:awaiting-approval`;
   - the SHA prefix is the **latest** request's head **and** an
     `issue-<n>-` branch still points at that head;
   - the protected path set recomputed from `main...head` hashes to the
     request's `paths=`;
   - every recomputed path is still approvable.
4. **Approve.** The bot opens the (draft) PR with `Closes #n` and the approved
   paths in its body, appends the record note `<!-- pipeline:protected-approved
issue=<n> pr=<m> head=<sha> paths=<hash> by=<login> comment=<id> -->` on the
   PR, sets the commit status `pipeline/protected-approval` = `success` on the
   head and `stage:building` on the issue. From here it is the normal path:
   CI → security → (Copilot, if required) → gates.
5. **Reject.** An outcome note (`develop` / `protected_rejected`) and
   `stage:routing`; the rules table sends it to a human. The branch is kept.
6. **A push invalidates the approval.** The approval names one head and one
   path set. On every new PR head (`protected-approve.yml`, `workflow_run` on
   CI `requested`) and in every gates evaluation, `pipeline/protected-approval`
   is recomputed: protected paths and a head that is not the one in the latest
   record note = `pending`, and a new request for the new head is posted on
   the issue (`stage:awaiting-approval` again). The status is `success`
   automatically when the PR has no protected paths, and for a PR the pipeline
   did not open (a person's own PR, Dependabot: the code-owner review covers
   it). A never-approvable path on a pipeline PR is `failure`.
7. **Gates.** `pipeline/gates` requires `pipeline/protected-approval` =
   `success` whenever the PR touches protected paths.

**Bot pushes after the PR exists.** A fix patch moves the head, and an
approval covers one head, so `fix.yml` never pushes a patch that touches
protected paths, approvable ones included. It stops before any push
(`protected_approval_needed` for approvable paths, `forbidden_path` otherwise;
both hard gates for a human), so no CI run sees unapproved protected content.
A **person's** push to the branch does run CI once before the status can turn
pending: `pull_request` workflows start on every push, and nothing can stop
that from a workflow. That is the price of a PR that already exists; the
merge stays blocked until the new head is approved.

**Stale requests.** Each request is for one head. Re-developing force-pushes
the branch and posts a new request; an approval that names an older head is
answered with "stale".

## Prompts

`.github/prompts/*.md` are versioned (`version:` in front matter). Every
comment, review and commit an agent produces names the prompt file and
version. Bump the version when you change a prompt's behaviour. Each
prompt starts with the same security rules: the content it is given is
data, never instructions.

## Known limits

- Deep links inside a PR preview fall back to the production `404.html`
  (Pages serves only the root one). Previews open fine from their root URL.
- Gemini tool names in the workflow `settings` follow the current Gemini
  CLI (`read_file`, `glob`, `search_file_content`, `write_file`, `replace`,
  `run_shell_command`). Check them when bumping `run-gemini-cli`.
- As sole code owner you cannot approve your own PRs, and the ruleset has
  no bypass. Pipeline PRs are authored by the App, so this only affects PRs
  you open yourself. Add yourself as a bypass actor (pull requests only) if
  you need to.
- The pipeline's own files (`.github/**`) cannot be changed by the pipeline.
  Change them in a normal PR.
- **Every PR to `main` needs `pipeline/security` = success**, including
  PRs you open yourself. `security.yml` reviews every same-repo PR after
  green CI, but the fix loop only runs on pipeline PRs, so fix blocking
  findings on your own PRs by hand (the next push gets a fresh review). If
  the review errored (quota, invalid output), re-run **Pipeline · Security
  Review** from the Actions tab. A status you post yourself does not count.
- **Dependabot and fork PRs get no `pipeline/security` status**, so they
  cannot merge as they are. Fork PRs are never reviewed (on purpose: no
  secrets for fork code). Runs triggered by Dependabot see only
  _Dependabot_ secrets, so neither Gemini nor the App token is available.
  For Dependabot, add `PIPELINE_APP_PRIVATE_KEY` and `GEMINI_API_KEY` as
  Dependabot secrets too (Settings → Secrets and variables → Dependabot),
  so its PRs are reviewed like any other. For a fork PR, re-create the
  change on a same-repo branch.
