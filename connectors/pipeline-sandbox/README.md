# Connector: menashsoffer/pipeline-sandbox

The files under this folder belong in the **root** of
`menashsoffer/pipeline-sandbox`. They are kept here, next to the engine they
call, so they are reviewed and tested together. Nothing from the sandbox is
imported into this repository, nothing here runs in it, and **no pull request
to the sandbox exists yet**: the owner copies these files there by hand.

| File                                     | Role                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `.github/workflows/pipeline-plan.yml`    | `stage:qualified` → engine plan stage                                     |
| `.github/workflows/pipeline-develop.yml` | `stage:planned` → engine develop, check, then publish (draft PR)          |
| `.github/pipeline-profile.json`          | the sandbox profile: documentation only, one writable file, exact content |
| `SANDBOX_PROBE.md`                       | the only file the pilot may change                                        |

The workflows are thin adapters: they have no steps, only `uses:` calls to
the engine's reusable workflows, all pinned to one engine commit
(`80c0874459d91fe5e55076915a67f55ad403bc4a`, the head of the profile
branch). The same commit is passed as `engine-commit`, and the engine checks
both against GitHub's OIDC claims. The engine takes the repository and the
issue from the workflow context, never from the issue text.

## Status: not tested end to end

Nothing here has run on GitHub. The engine's parts are tested in this
repository (`pnpm test:pipeline`) with simulated events, a fake GitHub CLI and
OIDC endpoint, and real git patches, but no issue has gone through the
sandbox. Do not read the tests as proof that the pilot works end to end.

## The sandbox profile

- **Documentation only.** No setup or verify commands and no commands for
  the agent: nothing is installed and no target code runs.
- **One writable file:** `SANDBOX_PROBE.md`, which must stay a regular file
  (no symbolic link, no mode change). A plan or patch that names any other
  path stops. The engine protects `.github/**`, manifests, lockfiles,
  `.nvmrc`, `AGENTS.md` and more in every target; the profile adds
  `README.md`.
- **Exact content.** The issue must contain the whole expected file:

  ````markdown
  ```expected SANDBOX_PROBE.md
  # Sandbox probe

  The line the pilot should add.
  ```
  ````

  The `check` stage compares the result with it byte for byte
  (`exact-content`); valid Markdown with other content fails. The other
  checks (`patch-not-empty`, `writable-paths`, `markdown-files`, plus the
  engine's `regular-files` and `file-length`) never pass on an empty change.

- **Limits:** one file, 50 changed lines (the engine allows at most 10 files
  and 400 lines, and no profile can raise that).

## What the sandbox does not have (yet)

The engine opens a **draft** PR and stops. In this repository more gates
follow; in the sandbox none of them exist:

- **No CI.** There is no workflow on `pull_request`, so the draft PR gets no
  checks and no required status. The engine's own checks ran before the
  push, but nothing re-checks the PR after a person edits it.
- **No review gates.** No `approval.yml`, no Copilot or review-thread gate,
  no `/disposition`, no protected-change approval, no preview. A person reads
  the diff and decides.
- **No router.** A problem outcome note sets `stage:routing` and stays there;
  no `router.yml` re-plans, re-develops or hands off. A person reads the
  note and restarts by moving the label.
- **No `done.yml` or Project sync:** labels stay as they are after a merge.
- **No branch protection is set by this connector.** Rulesets, required
  reviews and code owners are repository settings the owner decides on.

## Coexistence with direct Claude workflows

The sandbox may also run its own Claude workflows (for example the standard
`claude.yml` that answers `@claude`, or an automatic review). Run the
coexistence check **before copying**, on the candidate the copy would
produce: the sandbox's existing workflows plus the connector's.

```sh
node .github/scripts/connector-coexistence.mjs \
  --existing <sandbox>/.github/workflows \
  --connector connectors/pipeline-sandbox/.github/workflows
```

After copying, the same check runs on the installed folder:
`node .github/scripts/connector-coexistence.mjs <sandbox>/.github/workflows`.

It fails when:

- an existing workflow has a connector file's name (the copy would
  overwrite it);
- another workflow runs on issue label changes and not every job filters
  out the pipeline's `stage:*` labels. A job counts as filtered when its
  `if:` holds `!startsWith(github.event.label.name, 'stage:')`, matches one
  named non-stage label, or skips `labeled` events, with no `||`;
- another workflow runs on a push of an `issue-<n>-*` branch, reads
  `PIPELINE_APP_PRIVATE_KEY`, passes `secrets: inherit`, calls the engine
  outside the connector or shares its concurrency groups.

It warns when a direct Claude job can push branches (it could push to an
`issue-<n>-*` branch the engine publishes) or answers on pipeline issues.
The standard `claude.yml` passes with those two warnings
(`connector-coexistence.test.mjs`). The sandbox's actual workflows were not
available here and have not been checked.

## Installing it (the owner, by hand)

1. Run the coexistence check above on the candidate and resolve its errors.
2. Copy these files into the sandbox's default branch.
3. Install the pipeline GitHub App on the sandbox (issues, contents and pull
   requests: write; no `workflows` permission).
4. Set the secrets `CLAUDE_CODE_OAUTH_TOKEN` and `PIPELINE_APP_PRIVATE_KEY`
   and the variables `PIPELINE_BOT_LOGIN` and `PIPELINE_APP_CLIENT_ID`.
5. Once the engine branches are merged, move the pin (every `@<commit>` and
   every `engine-commit` in the two workflows) to a commit on `main`, so it
   can never be garbage-collected with a deleted branch.

`pnpm test:pipeline` checks this folder: the pins, the permissions, secrets
and inputs each call gets against the engine workflows
(`connector-sandbox.test.mjs`), and the profile through the engine's policy
and checks (`connector-sandbox-pilot.test.mjs`).
