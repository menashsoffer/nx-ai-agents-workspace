# Agents

> Instinct's role as a PR reviewer is **unverified**. Everything else on this
> page is confirmed by the owner or by this repo.

Who does what in this repo. Three kinds of agent work on it:

- **Pipeline agents** are defined in this repo. GitHub Actions workflows
  start them from issue labels, and deterministic jobs check what they produce.
  See [pipeline.md](pipeline.md).
- **Expert bots** run outside the repo, in the owner's Grok Bot workspace
  (a desktop assistant app). They work through normal issues and PRs.
- **Slack agents** run outside the repo, in the Slack workspace.

Nothing in `.github/`, `AGENTS.md` or `docs/` starts or configures the agents
outside the repo.

No agent can merge. A code owner's approval on a green PR (`ci`, `security`
and `pipeline/gates`) is the only way into `main`
([Review gates](pipeline-review.md#review-gates-and-dispositions)).

## Pipeline agents (in this repo)

### Plan

- **Prompt:** `.github/prompts/plan.md` (spec writer and tech lead, one run).
- **Runs in:** `plan.yml`, job `plan`, through `anthropics/claude-code-action`
  (Claude, `CLAUDE_CODE_OAUTH_TOKEN`), at most 40 turns.
- **Trigger:** `stage:qualified` added to an open issue (by a person, or by the
  router or `/restart qualified`).
- **Tools:** `Read`, `Glob`, `Grep` only. No shell, no edits, no web.
- **Output:** one JSON object (`--json-schema`) with a `spec` and a `plan`.
  The `publish` job posts them as two bot comments (`<!-- pipeline:spec -->`,
  `<!-- pipeline:plan -->`) and, if every
  [auto-approval check](pipeline-running.md#spec-and-plan-auto-approval)
  passes, sets `stage:planned`. Otherwise an outcome note and `stage:routing`.

### Develop

- **Prompt:** `.github/prompts/develop.md`.
- **Runs in:** `develop.yml`, job `implement`, through
  `anthropics/claude-code-action` (Claude), at most 150 turns.
- **Trigger:** `stage:planned` added to an open issue.
- **Tools:** file edits, `pnpm`, local `git status/diff/log/add/commit`.
  No `git push`, `gh`, `curl`, `wget` or web.
- **Output:** commits on `issue-<n>-<slug>` plus JSON (`status`, `pr_title`,
  `pr_body`, `blocked_reason`, `problem`). The `publish` job checks the patch,
  pushes the branch and opens a **draft PR** (`Closes #n`, `stage:building`).
  A patch whose protected paths are all approvable is pushed with no PR and
  waits for the owner
  ([Protected-change approval](pipeline-protected-changes.md#protected-change-approval)).

### Claude review

- **Prompt:** `.github/prompts/review.md`.
- **Runs in:** `review.yml`, job `review`, through
  `anthropics/claude-code-action` (Claude), at most 60 turns, with a
  read-only token.
- **Trigger:** once per head commit of a pipeline PR, after `ci` succeeds.
  Manual and Dependabot PRs are skipped.
- **Tools:** `Read`, `Glob`, `Grep` only. It does not run `pnpm verify`.
- **Output:** at most 5 findings against the issue's spec and plan
  (requirement, test, correctness, security; never style). The `publish` job
  posts them as review threads (`R-<n>`) and records the run in the
  `pipeline/review` status. See
  [Claude review](pipeline-review.md#claude-review) and the ADR
  [2026-11-23-claude-review-stage](decisions/2026-11-23-claude-review-stage.md).

### Copilot review (optional)

- **Runs in:** `approval.yml` requests it; GitHub Copilot code review writes it.
- **Trigger:** only when the repo variable `REQUIRE_COPILOT` is exactly `true`,
  once per head commit, after CI is green and no thread is open. Off by default.
- **Output:** review threads (`C-<n>`). Each must be resolved or
  dispositioned by the owner (`/disposition`) before `pipeline/gates` passes.
  See [Copilot review is optional](pipeline-review.md#copilot-review-is-optional).

### Router brain (stub)

- **Code:** `.github/scripts/router-external.mjs`, called by the `brain` job of
  `router.yml` (read-only token).
- **Trigger:** `stage:routing`, only when `ROUTER_MODE=external` or
  `ROUTER_SHADOW=true`.
- **Today:** it returns `null` and makes no network call, so the rules table
  decides every route. See [Router](pipeline-router.md#router).

There is no automated fixing of review comments (ADR
[2026-10-03-remove-gemini-stages](decisions/2026-10-03-remove-gemini-stages.md)).

## Expert bots (Grok Bot workspace)

Each bot in the owner's Grok Bot workspace has its own chat, memory and
routines, and the bots can message each other. The owner talks to them
directly. They work on this repo only through normal GitHub issues and PRs,
so their changes pass the same checks as anyone's, and a human merges.

| Bot               | Owns                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `site-expert`     | `apps/site`: the Vite product app                                        |
| `e2e-expert`      | `apps/site-e2e`: the Playwright tests for `site`                         |
| `pipeline-expert` | the CI and agent pipeline (`.github/workflows/`, scripts, prompts)       |
| `docs-expert`     | `README.md`, `docs/`, and the explanations of the agents and pipeline    |
| `cleaner`         | nothing in the repo: a meta-agent that audits which expert bots are used |

`.github/**` is never approvable for the pipeline agents
([AGENTS.md](../AGENTS.md), "Protected files"), so `pipeline-expert`'s changes
there go through a normal PR that the owner reviews.

The workspace also has bots that do not work on this repo; they are not
listed here.

## Slack agents

They use the Slack workspace **Do It**, channel **#ai**. The Slack apps
there are **Instinct**, **Cursor** (Cursor Cloud Agents, default repository
`menashsoffer/nx-ai-agents-workspace`) and **GitHub** (GitHub for Slack).

### Instinct

- **What it is:** a Slack bot app (`@Instinct`) in #ai.
- **What it does:** coordinates. It sends tasks to `@Cursor` in #ai threads
  (for example: split `pipeline-lib.mjs` for #99, harden
  `tools/pages/src/serve.mjs` for #120), asks `@Cursor` for agent status, and
  asks `@GitHub` for open PRs, issues and CI status. Code changes it asks for
  are done by Cursor agents on a new branch with a PR, never on `main`.
- **Unverified:** that Instinct **reviews PRs**. How a review is triggered,
  and where it lands (a PR review, a comment, or Slack only), is not recorded
  yet.
- **Not a gate:** `pipeline/gates` and the ruleset do not read anything
  Instinct writes. Its output counts only through the humans who act on it.

## How they fit together

1. Work starts as a GitHub issue (`[Task]` template). A person adds
   `stage:qualified`, and the pipeline agents take it from there
   ([Running one task](pipeline-running.md#running-one-task-through-it)).
2. Outside the pipeline, an expert bot, Instinct (through `@Cursor`) or a
   person can open an issue or a PR directly. Such a PR is **not** a pipeline
   PR: no `stage:*` label, and the pipeline does not plan or develop it. An
   issue they open goes through the pipeline like any other.
3. Every PR, from either source, needs the same checks: `ci`, `security` and
   `pipeline/gates` (CI green, every review thread resolved or dispositioned,
   protected changes approved). Then a code owner approves and merges.
4. Expert bots and Slack agents have no special standing in the pipeline: a
   label, a comment or a review they post is treated like anyone's. Only notes by
   `PIPELINE_BOT_LOGIN` and commands by `PIPELINE_OWNER_LOGIN` count.

## Open questions

- Where Instinct's PR reviews appear, and whether the owner treats them as
  required before merging.
