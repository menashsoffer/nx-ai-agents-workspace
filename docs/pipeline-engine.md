# Pipeline engine (reusable stages)

The pipeline's plan, develop and publish stages can run against another
repository (a **target**) without copying the pipeline into it. The target
keeps a thin **connector**: event workflows that call this repository's
reusable workflows, pinned to one engine commit. Nothing from the target is
imported here, and this repository's own pipeline (`plan.yml`,
`develop.yml`, ...) is unchanged.

| Reusable workflow    | Called on                           | Agent                   | Writes                                                                          |
| -------------------- | ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `engine-plan.yml`    | `issues: labeled` `stage:qualified` | Claude, read-only tools | spec + plan comments and `stage:planned`, or an outcome note                    |
| `engine-develop.yml` | `issues: labeled` `stage:planned`   | Claude, read-only token | a patch artifact; its check job outputs the attestation                         |
| `engine-publish.yml` | same run, after develop             | none (deterministic)    | branch push + **draft** PR `Closes #n` and `stage:building`, or an outcome note |

## How a connector calls it

```yaml
jobs:
  plan:
    if: ${{ github.event.label.name == 'stage:qualified' }}
    uses: menashsoffer/nx-ai-agents-workspace/.github/workflows/engine-plan.yml@<40-hex commit>
    permissions: { contents: read, issues: read, id-token: write }
    with:
      engine-commit: <the same commit>
      bot-login: ${{ vars.PIPELINE_BOT_LOGIN }}
      app-client-id: ${{ vars.PIPELINE_APP_CLIENT_ID }}
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
      PIPELINE_APP_PRIVATE_KEY: ${{ secrets.PIPELINE_APP_PRIVATE_KEY }}
```

Develop and publish are two jobs of one connector workflow: `publish` has
`needs: develop`, `if: always()` and receives the develop outputs. Secrets are
passed by name, never with `secrets: inherit`; the develop call gets only the
model token.

## Guarantees

- **Pinned engine.** Each engine workflow starts with a `pin` job, the only
  job with `id-token: write`. Its GitHub OIDC claims must say that GitHub ran
  `<engine>/.github/workflows/<file>@<commit>` with exactly the
  `engine-commit` input (not a branch or tag), for the repository in the
  workflow context, and the engine checkout must be that commit
  (`engine-pin.mjs`). Every later job checks out the engine at the commit the
  pin job verified.
- **Two checkouts, no isolation claim.** The engine (scripts, prompts) is
  checked out at the pinned commit and moved to `$RUNNER_TEMP/engine`; the
  target is the agent's working directory, so the patch holds only target
  files. This is not isolation: an agent can read and write its whole
  runner. Nothing produced on the agent's runner is trusted, which is why
  the next point exists.
- **Attested base, patch and tree.** The develop `pin` job reads the
  target's default-branch head from the GitHub API before the agent job
  starts and outputs it as the base (with the branch name). The agent works
  on that base, but only its patch artifact and its JSON status leave its
  job. A fresh `check` job, with no secrets and no agent code, checks the
  patch, applies it itself to the pinned base and outputs an attestation
  (`engine-attestation.mjs`): target repository, id and issue, base, branch,
  engine commit, the patch's SHA-256, the resulting git tree and
  `verification: passed`. Publish requires the attestation to match the
  target, the engine commit and the base from the pin job (an older base
  fails), hashes the patch it downloads (a replaced patch fails), requires
  the base on the default branch, applies the patch and requires the
  attested tree before it pushes.
- **Target identity from the workflow context.** The repository and issue
  come from `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_ID`, `GITHUB_EVENT_NAME`
  and the event payload, which must agree (`engine-target.mjs`). No workflow
  input names a repository or an issue, and the issue's title, body and
  comments are never read for it. Concurrency groups and the attestation
  carry the repository, so issue 7 of two repositories never mix: publish
  refuses an attestation from another repository, issue, base or engine
  commit.
- **Secrets in the request stop the run.** Before the agent step, the
  collected issue (title, body, spec, plan, comments) is scanned for
  credential shapes (`engine-request.mjs`). A match skips the agent and posts
  a `needs_secrets_ci_infra` outcome naming the field and the kind, never the
  value.
- **The developer has no write token.** The implement job has `contents:
read` and `issues: read` only, and no secret but the model token. Its
  commits leave as an artifact.
- **Checks before secrets.** The `check` job checks the patch before it
  applies it, and `engine-publish.yml` checks the attestation and the patch
  again on a fresh runner before it mints the App token. A patch that
  touches a protected path (`.github/`, `CODEOWNERS`, ...) never reaches a
  push.
- **Deterministic publishing.** No model runs in publish. It applies the
  patch, pushes `issue-<n>-<slug>` and opens a draft PR with `gh pr create
--draft`. It never runs target code. Only a person can mark it ready,
  approve and merge.

## Known limits

- The engine repository name is fixed in `engine-pin.mjs` and in every
  engine checkout (`menashsoffer/nx-ai-agents-workspace`); a fork changes
  both.
- A target without a router (`router.yml`) keeps a problem item at
  `stage:routing` until a person acts on the outcome note.
- The target needs, set by its owner: the pipeline App installed, the
  `CLAUDE_CODE_OAUTH_TOKEN` and `PIPELINE_APP_PRIVATE_KEY` secrets and the
  `PIPELINE_BOT_LOGIN` and `PIPELINE_APP_CLIENT_ID` variables.

See the decision record
[2026-10-13-pipeline-engine-workflow-call.md](decisions/2026-10-13-pipeline-engine-workflow-call.md).
