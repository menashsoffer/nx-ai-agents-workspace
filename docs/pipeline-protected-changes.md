# Protected changes, prompts and known limits

## Protected-change approval

A task that needs a dependency, a new app or lib, or a change to a workspace
generator used to dead-end at a hard gate and the owner redid it locally. Now
the owner **approves such a change once, before any PR exists**. This is a
two-week trial.

**Which paths.** `pipeline-lib.mjs` has two lists, and `APPROVABLE_PATH_PATTERNS`
is a strict subset of `FORBIDDEN_PATH_PATTERNS` (a test asserts it):

| Kind                 | Paths                                                                                                             | What happens                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Approvable**       | any `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tools/workspace-plugin/**`, `tools/pipeline-map/**` | The owner approves the diff with a command (this section)           |
| **Never approvable** | `.github/**`, `CODEOWNERS`, `tools/security/**`, `.claude/`, `.codex/`, `.pipeline/`, `.npmrc`, `.gitmodules`     | `forbidden_path` hard gate, exactly as before; a local session only |

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
   CI → (Copilot, if required) → gates.
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

**Pushes after the PR exists.** No workflow pushes to a PR's branch once the
PR is open, so no CI run sees unapproved protected content from a bot. A
**person's** push to the branch does run CI once before the status can turn
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
- As sole code owner you cannot approve your own PRs. The ruleset lets you
  (`PIPELINE_OWNER_LOGIN`) bypass it, but only inside a PR (bypass mode "pull
  request"): you still cannot push to `main`. Bots and Apps have no bypass. Pipeline PRs are authored by
  the App, so this only affects PRs you open yourself.
- The pipeline's own files (`.github/**`) cannot be changed by the pipeline.
  Change them in a normal PR.
- **Every PR to `main` needs `pipeline/gates` = success** (CI green, no open
  review thread, and the Copilot review when it is required), including PRs
  you open yourself. `approval.yml` evaluates every same-repo PR after green
  CI. A status you post yourself does not count.
- **Dependabot and fork PRs get no `pipeline/gates` status**, so they
  cannot merge as they are. Runs triggered by Dependabot see only
  _Dependabot_ secrets, so the App token is not available. For Dependabot,
  add `PIPELINE_APP_PRIVATE_KEY` as a Dependabot secret too (Settings →
  Secrets and variables → Dependabot), so its PRs get the status like any
  other. For a fork PR, re-create the change on a same-repo branch.
