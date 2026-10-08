# Multi-agent pipeline (stage 1)

An issue goes in; a reviewed, previewed, human-approved pull request comes
out. Claude does the writing. Deterministic workflows move work
between stages, check every agent output, and hold every token that can
write. **No agent can merge.** Only a code owner's approval on a green PR
unlocks the merge button.

Every stage leaves an **outcome note** (success or problem). A problem goes
to one **router** that decides where the work goes next: re-plan,
re-develop, retry, or a human. Loops are bounded; hard gates always stop
at a human. See [Router](pipeline-router.md#router).

## The flow

The full map (every stage, workflow and escalation path, plus
computed findings) is generated from the workflows and `pipeline-lib.mjs`:
see **[pipeline-map.md](pipeline-map.md)**. Regenerate it with
`pnpm pipeline:map` after changing a workflow or `pipeline-lib.mjs`;
`pnpm verify` fails while it is stale.

In the map, solid arrows are the fast path: each stage appends a success outcome note
and sets the next label itself. Dashed red arrows: a stage that hits a problem
appends a problem outcome note and sets `stage:routing`; only the router
decides what happens next.

| Stage label               | Set by                                 | Meaning / next step                                                                                                                                                                                  |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage:inbox`             | `inbox.yml`                            | New issue. A maintainer triages it.                                                                                                                                                                  |
| `stage:qualified`         | **a human**, `restart.yml`             | Starts the planning agent (`plan.yml`): one Claude run writes the spec **and** the plan. (Also the owner's `/restart qualified`.)                                                                    |
| `stage:spec`              | _nothing_                              | **Deprecated.** No workflow sets it or starts a stage on it. It stays so old items keep their board column.                                                                                          |
| `stage:planned`           | `plan.yml`, `restart.yml`              | Spec and plan comments posted and auto-approved (or the owner's `/restart planned`). Starts the develop agent.                                                                                       |
| `stage:awaiting-approval` | `develop.yml`, `protected-approve.yml` | Protected changes are pushed to a branch with **no PR**; the owner reads the diff and approves or rejects. See [Protected-change approval](pipeline-protected-changes.md#protected-change-approval). |
| `stage:building`          | `develop.yml`                          | Draft PR open (on the issue and the PR). CI runs.                                                                                                                                                    |
| `stage:human-approval`    | `approval.yml`                         | Everything green. A human reviews the PR and the preview, then approves and merges.                                                                                                                  |
| `stage:routing`           | any step                               | A stage reported a problem in an outcome note. `router.yml` decides the next step.                                                                                                                   |
| `stage:needs-attention`   | `router.yml`                           | The router handed off. Read its latest `pipeline:route` note and act; only the owner's `/restart` restarts it (3 per issue, lifetime).                                                               |
| `stage:done`              | `done.yml`                             | The PR merged. Set on the PR and its issues; terminal. See [When a PR closes](#when-a-pr-closes).                                                                                                    |

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
  `stage:*` label is removed. The router is not involved. The Project cards move to **Done** (set directly by `done.yml`
  when `PROJECT_URL` is set, and again by `project-sync.yml` from the label).
- **Closed without merging:** no code may be silently abandoned. Each
  linked issue that is still open gets an outcome note (stage `pr`,
  problem `pr_closed`, with the PR number and who closed it) and
  `stage:routing`; the router hands it to a human (`stage:needs-attention`).
  An issue is skipped when another open PR is linked to it (a replacement
  PR), or when it is already closed. The closed PR's `stage:*` labels are
  cleared, so no stage picks it up again; its card
  stays where it was (the Project's built-in "Item closed" workflow moves
  it to Done if enabled).

**Closed items stay done.** `project-sync.yml` ignores stage labels added
to a closed issue or PR, except `stage:done`, so a late label cannot pull a
card out of Done. The router ignores closed issues and PRs (label events
and manual runs); an open issue whose PR was closed still routes.

## Workflows

| Workflow                | Trigger                                                                                | Agent                          | Output                                                                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inbox.yml`             | issue opened                                                                           | none                           | `stage:inbox`, Project item in Inbox                                                                                                                                                             |
| `plan.yml`              | `stage:qualified` added                                                                | Claude (`plan.md`)             | spec + plan comments, `stage:planned` (or an outcome note + `stage:routing`)                                                                                                                     |
| `develop.yml`           | `stage:planned` added                                                                  | Claude (`develop.md`)          | branch `issue-<n>-<slug>`, draft PR `Closes #n`, `stage:building`; approvable protected changes: branch only, `stage:awaiting-approval`                                                          |
| `protected-approve.yml` | owner comment on an issue; CI requested on a same-repo PR                              | none                           | `/approve-protected` opens the PR and sets `pipeline/protected-approval`; a new PR head recomputes it (see [Protected-change approval](pipeline-protected-changes.md#protected-change-approval)) |
| `router.yml`            | `stage:routing` added (open issue or PR), or manual                                    | none (optional external brain) | route note, then the target's label                                                                                                                                                              |
| `restart.yml`           | owner `/restart` comment on an issue; a person changes `stage:needs-attention` by hand | none                           | lifetime counter + restart route note + stage label; or one pointer note to `/restart`                                                                                                           |
| `ci.yml`                | every PR                                                                               | none                           | **required check `ci`**: format, lint, typecheck, unit, build, e2e (site)                                                                                                                        |
| `ci-failed.yml`         | CI failed on a pipeline PR's head                                                      | none                           | outcome note `ci_failed` + `stage:routing` (router → human)                                                                                                                                      |
| `approval.yml`          | CI succeeded on a PR, review submitted, disposition note, manual                       | none                           | `pipeline/gates` status; optional Copilot review request (`REQUIRE_COPILOT`), then `stage:human-approval` + preview comment                                                                      |
| `approval.yml`          | CI requested on a same-repo PR                                                         | none                           | `pipeline/gates` = pending on the new head                                                                                                                                                       |
| `disposition.yml`       | comment created on a PR                                                                | none                           | owner's `/disposition` → resolved threads + record notes (see [Review gates](pipeline-review.md#review-gates-and-dispositions))                                                                  |
| `preview.yml`           | PR opened/updated/closed                                                               | none                           | `https://<owner>.github.io/<repo>/pr-<n>/`, removed on close                                                                                                                                     |
| `done.yml`              | PR closed                                                                              | none                           | merged: `stage:done` + Project **Done**; unmerged: `pr_closed` note + `stage:routing` on the issue                                                                                               |
| `project-sync.yml`      | any `stage:*` label added (closed items: `stage:done` only)                            | none                           | Project **Status** follows the label                                                                                                                                                             |
| `deploy.yml`            | push to `main`                                                                         | none                           | site at `/`, Storybook at `/storybook/`, keeps `pr-*/` previews                                                                                                                                  |

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
  - develop patches: rejected if they touch `.github/`, `CODEOWNERS`,
    `.claude/`, `.codex/`, `.pipeline/`, `tools/security/`,
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
    approval](pipeline-protected-changes.md#protected-change-approval)). So **agents cannot add or change dependencies, scripts
    or projects on their own**: the owner approves each such change once,
    before any PR exists.
- **Minimal tools.** Plan (spec + plan): Claude `Read, Glob, Grep`. Develop:
  file edits, `pnpm` and local `git add/commit` only; no push, `gh`, `curl`
  or web.
- **Markers count only from the bot.** Anyone can post a comment containing
  `<!-- pipeline-state -->` or `<!-- pipeline:spec -->`. The scripts match a
  marker comment only if `PIPELINE_BOT_LOGIN` wrote it (the preview comment:
  `github-actions[bot]`), and the plan/develop agents get the spec and plan
  as separate fields taken from the bot's comments, with markers in all
  other text neutralised. Editing the bot's spec comment keeps the bot as
  its author, so that still works.
- **Trusted code only.** Workflows triggered by `workflow_run` or
  reviews load prompts and scripts from the default branch, not from the PR.
  Fork PRs never reach an agent.
- **No merge path for bots.** The ruleset needs a code-owner approval after
  the last push, resolved conversations, and three green, up-to-date status
  checks: `ci` and `security` (the two jobs of `ci.yml`, from GitHub
  Actions) and `pipeline/gates` (the sum of every review gate, accepted
  **only from the pipeline App**, so no other token can post a passing
  one). The only bypass actor is the repo owner (`PIPELINE_OWNER_LOGIN`),
  and only inside a PR (bypass mode "pull request"): nobody can push to
  `main`, and no bot or App can bypass anything. The pipeline App has no
  `workflows` or `administration` permission. `GITHUB_TOKEN` cannot approve
  PRs.
- **Bounded loops.** Router loops per item: re-plan 2, re-develop 1, and 5
  routed rounds in total (`ROUTER_CAPS`); after that, a human. See
  [Router](pipeline-router.md#router).
- **Notes are trusted by author.** The router reads only outcome and route
  notes written by `PIPELINE_BOT_LOGIN`; anyone can comment on a public repo.
- **Pinned supply chain.** Every action is pinned to a commit SHA, with the
  version in a comment.
- **Minimal permissions.** Every workflow sets `permissions: {}` at the top
  and grants per job; App tokens are down-scoped per job.

### Concurrency

Every job has a concurrency group `pipeline-issue-<n>-<step>` or
`pipeline-pr-<n>-<step>`. The step suffix matters: GitHub keeps only one
pending run per group and cancels the rest, so one shared
`pipeline-pr-<n>` group would silently drop CI, preview or review runs.
`approval.yml` uses `pipeline-pr-<n>-state`, because it updates the state
comment. `router.yml` uses
`pipeline-item-<n>-router` (issues and PRs share one number space);
`restart.yml` uses `pipeline-issue-<n>-restart` so two `/restart` comments
cannot read the same counter.

## One-time setup

The pipeline workflows react to issue, review and `workflow_run` events,
which always run the workflow files **on the default branch**.
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
   | variable | `PROJECT_URL`              | set by `setup-project.sh`; leave unset to run without a Project                                                                                                                                                      |
   | secret   | `PROJECT_TOKEN`            | classic PAT, `project` scope (App tokens cannot reach user-owned Projects)                                                                                                                                           |
   | variable | `REQUIRE_COPILOT`          | optional: exactly `true` makes a Copilot review a required gate ([Copilot review is optional](pipeline-review.md#copilot-review-is-optional)); unset or anything else = off                                          |
   | secret   | `COPILOT_REVIEW_TOKEN`     | only with `REQUIRE_COPILOT=true`: PAT of a user with Copilot code review (Pull requests: write); App token if unset                                                                                                  |
   | variable | `ROUTER_MODE`              | optional: `rules` (default when unset) or `external` ([Router](pipeline-router.md#router))                                                                                                                           |
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
   It creates or updates the ruleset "main protection (pipeline)" so it is
   exactly what the "No merge path for bots" guardrail (see [Guardrails](#guardrails)) describes: required
   checks `ci` and `security` (GitHub Actions) and `pipeline/gates` (pinned
   to the pipeline App's ID), and the owner as the only bypass actor, in PRs
   only. Prerequisites: the repo variable `PIPELINE_OWNER_LOGIN` (it fails
   without it) and the App's ID. The App is private, so `apps/<slug>` returns
   404: set `PIPELINE_APP_ID=<App ID>` (App settings → App ID) when you run
   it, or let it read the ID off a recent comment the App wrote (found from
   `PIPELINE_BOT_LOGIN`). Run it with `DRY_RUN=1` first to print the JSON it
   would send. Re-run it if you replace the App.
