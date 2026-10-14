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
| `engine-develop.yml` | `issues: labeled` `stage:planned`   | Claude, read-only token | a patch artifact, plus the base and branch its `pin` job read from GitHub       |
| `engine-check.yml`   | same run, after develop             | none (no secrets)       | nothing: runs the verify commands, then outputs the attestation                 |
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

Develop, check and publish are three jobs of one connector workflow:
`check` (`engine-check.yml`: verify and attest, no agent, no secrets) runs
after `develop` succeeded, and `publish` has `if: always()` and receives the
outputs of both. Secrets are
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
  job. In `engine-check.yml`, the `verify` job runs the profile's commands
  (target code) on its own runner, through a trusted orchestrator: before
  any target code, the engine checkout and the profile become root-owned
  and read-only and sudo and Docker access are removed (the step fails if
  sudo stays); then one engine process (`verify-target`), already loaded,
  runs every setup and verify command as a child and decides from their
  exit codes. A setup command that rewrites the engine cannot change that
  process (`engine-verify-cli.test.mjs`). After it passed, the `check` job, with no secrets and no agent
  or target code, checks the
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
- **Notes from closed sets.** Nothing from the agent's runner is posted as
  it is (`engine-notes.mjs`). The request findings leave the agent's job
  only as `field:kind` pairs, which publish checks against the known fields
  and secret kinds (anything else gives a fixed note without details). The
  develop problem note keeps the developer's problem code only if it is in
  the allowed enum, and never its free text. The prompt version comes from
  the engine's own prompt file at the pinned commit. Every note, spec, plan,
  PR title and PR body is scanned for secret-shaped values right before it
  is written.
- **Deterministic publishing.** No model runs in publish. It applies the
  patch, pushes `issue-<n>-<slug>` and opens a draft PR with `gh pr create
--draft`. It never runs target code. Only a person can mark it ready,
  approve and merge.

## Target profile and policy

Every target has a profile at `.github/pipeline-profile.json` on its default
branch (this repository's own is an example). The engine refuses to run
without a valid one. It says what the engine may not assume:

| Field           | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `schema`        | `1`                                                                                            |
| `name`          | lowercase slug                                                                                 |
| `summary`       | the stack in one paragraph, for the prompts                                                    |
| `conventions`   | up to 20 short rules, for the prompts                                                          |
| `commands`      | `setup` and `verify`: argv lists run without a shell, with no tokens in their environment      |
| `agentCommands` | the only commands the developer agent may run (prefix rules)                                   |
| `checks`        | built-in engine checks: `patch-not-empty`, `writable-paths`, `markdown-files`, `exact-content` |
| `paths`         | `protected` (added to the engine minimum) and `writable` (an allowlist, optional)              |
| `limits`        | `maxFiles` and `maxLines` for the plan and the real patch, at most the engine ceilings         |

`validateProfile` (`engine-profile.mjs`) rejects an unknown field at any
level, any key that would set the engine version (`engine-ref`, `ref`,
`sha`, ...: the connector's pin decides), and any command outside its
grammar: only `node <repository script>`, `pnpm <allowed subcommand or
script>` (`install` only with `--frozen-lockfile`; never `dlx`, `exec`,
`add`, ...) and `corepack enable`, with no shell characters, absolute paths
or `..`. A profile needs at least one verify command or check, so nothing
passes by checking nothing; every built-in check also fails when it has
nothing to look at.

The engine policy (`engine-policy.mjs`) protects, in every target:
`.github/**` (the workflows and the profile) and any nested
`.github/workflows/`, `CODEOWNERS`, `AGENTS.md` and `CLAUDE.md`, `.claude/`,
`.codex/`, `.pipeline/`, every `package.json`, lockfile
(`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock[b]`,
`npm-shrinkwrap.json`), `pnpm-workspace.yaml`, `.npmrc`, `.yarnrc*`,
`.nvmrc`, `.node-version`, `.tool-versions`, `.gitmodules` and
`.gitattributes`. A profile can only add to that list. The engine also fixes
ceilings no profile can raise: 10 files and 400 changed lines per plan or
patch, and 400 lines per file after the patch (`ENGINE_LIMITS`; the profile
schema rejects higher limits and `buildPolicy` clamps them again).

Patches are checked twice for what they are, not only where they go
(`engine-patch-metadata.mjs`): a symbolic link or submodule (mode `120000`,
`160000`), any mode change, a new file with a mode other than `100644`, and
binary content are rejected before the patch is applied. After it is
applied, the `check` job inspects every changed path with `lstat`
(`regular-files`): a symbolic link, also through a parent folder, fails, so
`SANDBOX_PROBE.md -> /etc/hostname` cannot pass.

Two checks always run: `regular-files` and `file-length`. With
`exact-content` the profile makes the result match the task exactly: the
issue body (read by the `check` job from the GitHub API) holds one block per
file, opened with ` ```expected <path> `, holding the whole file
after the change. The check fails when there is no such block, when a
changed file has none, or when a file differs by a single byte; valid
Markdown alone is not enough.

The plan stage stops a plan that names a protected or non-writable path
(`protected_surface`). `engine-check.yml` loads the profile from the pinned
base and checks the patch against the policy before it applies the patch or
runs any target command; the publish job checks again before it mints its
token. The agent's output is scanned for secret-shaped values like the
request (`engine-output-scan.mjs`): the planner's JSON before any comment
is posted; the developer's JSON and every publishable part of the patch
(commit subject, body and author, file names, diff headers and added
lines) in the `check` job and again in publish; the commits that would be
pushed (author, committer, subject, body) after `git am`, in both jobs; and
the PR title and body right before the branch is pushed. A finding stops
publishing and posts a `needs_secrets_ci_infra` note whose
`secret_in_output` details name only engine-made fields and kinds, never a
value or a name the agent chose. The prompts (`engine-plan.md`, `engine-develop.md`) name no
stack: the profile section the engine appends supplies it.

## Connectors

`connectors/<target>/` holds a target's connector files, reviewed and
tested here, for the owner to copy into the target's root. The first is
`connectors/pipeline-sandbox/` (see its `README.md`), for
`menashsoffer/pipeline-sandbox`: two thin workflows pinned to one engine
commit and a documentation-only profile whose only writable file is
`SANDBOX_PROBE.md`, checked for the task's exact content. It is a template
in this repository: no pull request to the sandbox exists, nothing has run
end to end, and the sandbox has no CI, review gates or router after the
draft PR (its README lists what is missing). `connector-sandbox.test.mjs`
checks the pins and each call's permissions, secrets and inputs against the
engine workflows; `connector-sandbox-pilot.test.mjs` runs the sandbox profile
through the policy and the checks; `connector-coexistence.mjs` checks,
before the copy, the candidate made of a target's existing workflows and the
connector's, and after it the installed folder; it checks a
target's own Claude workflows against the connector.

## Known limits

- The engine repository name is fixed in `engine-pin.mjs` and in every
  engine checkout (`menashsoffer/nx-ai-agents-workspace`); a fork changes
  both.
- A target without a router (`router.yml`) keeps a problem item at
  `stage:routing` until a person acts on the outcome note.
- The target needs, set by its owner: the pipeline App installed, the
  `CLAUDE_CODE_OAUTH_TOKEN` and `PIPELINE_APP_PRIVATE_KEY` secrets and the
  `PIPELINE_BOT_LOGIN` and `PIPELINE_APP_CLIENT_ID` variables.

See the decision records
[2026-10-13-pipeline-engine-workflow-call.md](decisions/2026-10-13-pipeline-engine-workflow-call.md)
and [2026-10-13-pipeline-target-profile.md](decisions/2026-10-13-pipeline-target-profile.md).
