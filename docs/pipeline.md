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

| Stage label             | Set by         | Meaning / next step                                                                                         |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `stage:inbox`           | `inbox.yml`    | New issue. A maintainer triages it.                                                                         |
| `stage:qualified`       | **a human**    | Starts the planning agent (`plan.yml`): one Claude run writes the spec **and** the plan.                    |
| `stage:spec`            | _nothing_      | **Deprecated.** No workflow sets it or starts a stage on it. It stays so old items keep their board column. |
| `stage:planned`         | `plan.yml`     | Spec and plan comments posted and auto-approved. Starts the develop agent.                                  |
| `stage:building`        | `develop.yml`  | Draft PR open (on the issue and the PR). CI runs.                                                           |
| `stage:reviewing`       | `security.yml` | Security review posted on the PR.                                                                           |
| `stage:fixing`          | `fix.yml`      | Fixer is applying review feedback.                                                                          |
| `stage:human-approval`  | `approval.yml` | Everything green. A human reviews the PR and the preview, then approves and merges.                         |
| `stage:routing`         | any step       | A stage reported a problem in an outcome note. `router.yml` decides the next step.                          |
| `stage:needs-attention` | `router.yml`   | The router handed off. Read its latest `pipeline:route` note and act.                                       |
| `stage:done`            | `done.yml`     | The PR merged. Set on the PR and its issues; terminal. See [When a PR closes](#when-a-pr-closes).           |
| `fix-loop:1` / `:2`     | `fix.yml`      | Automated fix rounds used. At most two. Cleared on escalation and at `stage:human-approval`.                |

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

| Workflow           | Trigger                                                     | Agent                          | Output                                                                                             |
| ------------------ | ----------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `inbox.yml`        | issue opened                                                | none                           | `stage:inbox`, Project item in Inbox                                                               |
| `plan.yml`         | `stage:qualified` added                                     | Claude (`plan.md`)             | spec + plan comments, `stage:planned` (or an outcome note + `stage:routing`)                       |
| `develop.yml`      | `stage:planned` added                                       | Claude (`develop.md`)          | branch `issue-<n>-<slug>`, draft PR `Closes #n`, `stage:building`                                  |
| `router.yml`       | `stage:routing` added (open issue or PR), or manual         | none (optional external brain) | route note, then the target's label (or a `fix.yml` retry dispatch)                                |
| `ci.yml`           | every PR                                                    | none                           | **required check `ci`**: format, lint, typecheck, unit, build, e2e (site)                          |
| `security.yml`     | CI succeeded on a PR                                        | Gemini (`security-review.md`)  | PR review, `pipeline/security` status, `stage:reviewing`                                           |
| `security.yml`     | CI failed on a pipeline PR's head                           | none                           | outcome note `ci_failed` + `stage:routing` (router → human)                                        |
| `fix.yml`          | review submitted, manual, or router retry                   | Gemini (`fix.md`)              | one fix commit per round, replies on threads                                                       |
| `approval.yml`     | `pipeline/security` status, review submitted, manual        | none                           | Copilot review request, then `stage:human-approval` + preview comment                              |
| `preview.yml`      | PR opened/updated/closed                                    | none                           | `https://<owner>.github.io/<repo>/pr-<n>/`, removed on close                                       |
| `done.yml`         | PR closed                                                   | none                           | merged: `stage:done` + Project **Done**; unmerged: `pr_closed` note + `stage:routing` on the issue |
| `project-sync.yml` | any `stage:*` label added (closed items: `stage:done` only) | none                           | Project **Status** follows the label                                                               |
| `deploy.yml`       | push to `main`                                              | none                           | site at `/`, Storybook at `/storybook/`, keeps `pr-*/` previews                                    |

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
    `.claude/`, `.gemini/` or `.pipeline/`, or the execution surface of
    `pnpm` (`package.json` and `pnpm-lock.yaml` at any depth,
    `pnpm-workspace.yaml`, `.npmrc`, `.gitmodules`), checked twice. The
    check reads every header `git apply` uses (`diff --git`, rename/copy,
    `---`/`+++`), decodes git's C-quoted names and rejects any patch it
    cannot parse. So
    **agents cannot add or change dependencies, scripts or projects**: a
    task that needs that stops at CI or review and a human finishes it.
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

The budget resets whenever `fix-loop:*` is cleared: on escalation (so a
human restart gives the PR two fresh rounds) and when the PR reaches
`stage:human-approval` (so later human feedback starts at round 1).

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
`pipeline-item-<n>-router` (issues and PRs share one number space).

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

   | Kind     | Name                       | Value                                                                                                                   |
   | -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
   | variable | `PIPELINE_APP_CLIENT_ID`   | the App's client ID                                                                                                     |
   | secret   | `PIPELINE_APP_PRIVATE_KEY` | the App's private key (PEM)                                                                                             |
   | variable | `PIPELINE_BOT_LOGIN`       | **required**: the App's bot login, e.g. `my-pipeline[bot]`; the only author whose marker comments and notes are trusted |
   | secret   | `CLAUDE_CODE_OAUTH_TOKEN`  | Claude subscription token from `claude setup-token` (Pro/Max); no API billing                                           |
   | secret   | `GEMINI_API_KEY`           | Gemini API key                                                                                                          |
   | variable | `GEMINI_MODEL`             | optional, e.g. a specific Gemini model                                                                                  |
   | variable | `PROJECT_URL`              | set by `setup-project.sh`; leave unset to run without a Project                                                         |
   | secret   | `PROJECT_TOKEN`            | classic PAT, `project` scope (App tokens cannot reach user-owned Projects)                                              |
   | secret   | `COPILOT_REVIEW_TOKEN`     | PAT of a user with Copilot code review (Pull requests: write); App token if unset                                       |
   | variable | `ROUTER_MODE`              | optional: `rules` (default when unset) or `external` ([Router](#router))                                                |
   | variable | `ROUTER_SHADOW`            | optional: `true` records the external brain's pick without using it                                                     |

4. **Labels:** `tools/scripts/pipeline/setup-labels.sh` (re-run it after
   upgrading to add new labels such as `stage:done`; it is idempotent)
5. **Project:** `gh auth refresh -s project && tools/scripts/pipeline/setup-project.sh`,
   then enable the built-in workflows it prints (Item closed → Done,
   Pull request merged → Done, Item reopened → Inbox). Labels are the
   source of truth; `project-sync.yml` moves cards when labels change.
   Dragging a card does **not** change labels. On an existing Project, add
   missing Status options (such as **Routing**) in the Project UI instead
   of re-running the script, which resets every item's Status.
6. **Pages:** Settings → Pages → Source: **Deploy from a branch**, branch
   `gh-pages`, folder `/ (root)`. Production and previews share that branch
   (see [ADR 0004](decisions/0004-gh-pages-branch-for-previews.md)).
7. **Copilot code review** enabled for the repo (Settings → Copilot → Code review).
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
6. **Copilot.** With CI green, the security status clean and no open
   threads, the pipeline requests Copilot. Its comments go through the same
   fix loop.
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
questions / fix the cause and restart a stage:

- spec + plan / develop: add the stage's trigger label (`stage:qualified`,
  `stage:planned`; an old item stuck in the deprecated `stage:spec` restarts
  with `stage:qualified`). The stage's own label change then clears
  `stage:needs-attention`;
- fix loop: remove `stage:needs-attention` (escalation already cleared
  `fix-loop:*`, so the PR gets two fresh rounds), then run **Pipeline ·
  Fix** manually with the PR number;
- approval: remove `stage:needs-attention`, then run **Pipeline · Approval**
  manually with the PR number;
- failed CI (`ci_failed`): push a fix to the PR branch. The next green CI
  run starts the security review, which moves the PR to `stage:reviewing`;
- closed PR (`pr_closed`, on the issue): reopen the PR, open a replacement
  PR, restart the issue from a stage label (re-develop force-pushes its
  `issue-<n>-` branch), or close the issue;
- router: run **Pipeline · Router** manually with the item number to route
  the latest outcome note again (it goes to a human if that note was
  already routed).

**Resetting loops.** Router caps count only the route notes after the
latest route to a human, so a restart after a hand-off always starts with
the full budget. There is nothing else to reset: escalation clears the
fix-loop label, which resets the fix rounds.

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
| No planned file matches `FORBIDDEN_PATH_PATTERNS`                        | `protected_surface` → human (hard gate)      |
| The planner reports no need for secrets, CI or infrastructure            | `needs_secrets_ci_infra` → human (hard gate) |
| At most `PLAN_MAX_FILES` (10) files and `PLAN_MAX_LINES` (400) lines     | `scope_split` → human                        |
| The planner reports no instructions embedded in the issue                | `embedded_instructions` → human (hard gate)  |

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

## Gemini queue

Gemini's daily quota was burned by parallel calls. The two jobs that call
`run-gemini-cli` (`security.yml` `review` and `fix.yml` `fix`) share one
concurrency group, `pipeline-gemini`, with `queue: max` and
`cancel-in-progress: false`: at most one Gemini job runs at a time and the
rest wait in FIFO order (up to 100). Two details matter:

- A concurrency group normally keeps only **one** pending run and cancels
  the older pending one, which would silently drop reviews in a burst.
  `queue: max` keeps them all.
- `queue: max` cannot be combined with `cancel-in-progress: true`, so the
  security review's old per-PR "newest head wins" cancellation is gone. In
  its place, the `fresh` step checks the PR head when the job finally starts
  and skips the Gemini call if the head moved (the publish job already
  ignores a review of an older head).

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

| Code                     | Reported by    | Meaning                                                                                                     |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `invalid_output`         | plan, security | The agent answered, but not in the required shape (plan: a required spec or plan section is missing)        |
| `agent_error`            | plan, dev, fix | The run failed: API/quota/timeout, empty output, no changes                                                 |
| `spec_missing`           | _legacy_       | Old plan-stage note: no spec comment. Still read, no longer written                                         |
| `spec_questions`         | plan           | The issue is unclear (blocking questions), or a criterion is not testable                                   |
| `untestable_criteria`    | _legacy_       | Old plan-stage note: criteria untestable. Still read, no longer written                                     |
| `verify_failed`          | develop, fix   | `pnpm verify` could not be made green (fix: the secret-free verify job failed on the patch)                 |
| `plan_gap`               | develop        | The plan is wrong or incomplete                                                                             |
| `budget_exhausted`       | fix            | Both fix rounds used                                                                                        |
| `copilot_request_failed` | approval       | The Copilot review could not be requested                                                                   |
| `ci_failed`              | ci             | CI failed on a pipeline PR's current head (`security.yml`'s `ci-failed` job)                                |
| `pr_closed`              | pr             | The issue's PR was closed without merging and no other open PR is linked (`done.yml`)                       |
| `protected_surface`      | plan, develop  | **Gate.** Touches `tools/security/`, `.github/`, `CODEOWNERS`, supply-chain settings, any manifest/lockfile |
| `needs_secrets_ci_infra` | plan, develop  | **Gate.** Needs secrets, CI/workflow changes, infra, a server                                               |
| `scope_split`            | plan           | Bigger than size L, or over the auto-approval size limits; split the issue (routes to a human)              |
| `embedded_instructions`  | plan           | **Gate.** The issue contains instructions aimed at the agents                                               |
| `forbidden_path`         | develop, fix   | **Gate.** `check-patch` rejected the patch                                                                  |

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
  Rounds are counted from the bot's route notes after the latest route to
  a human.
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
