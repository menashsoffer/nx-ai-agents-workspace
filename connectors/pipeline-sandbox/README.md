# Connector: menashsoffer/pipeline-sandbox

The files under this folder belong in the **root** of
`menashsoffer/pipeline-sandbox`. They are kept here, next to the engine they
call, so they are reviewed and tested together. Nothing from the sandbox is
imported into this repository, and nothing here runs in it.

| File                                     | Role                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `.github/workflows/pipeline-plan.yml`    | `stage:qualified` → engine plan stage                                  |
| `.github/workflows/pipeline-develop.yml` | `stage:planned` → engine develop stage, then engine publish (draft PR) |
| `.github/pipeline-profile.json`          | the sandbox profile: documentation only, one writable file             |
| `SANDBOX_PROBE.md`                       | the only file the pilot may change                                     |

The workflows are thin adapters: they have no steps, only `uses:` calls to
the engine's reusable workflows, all pinned to one engine commit
(`fd6855ae05fc30898c38f9e01393fc073edf0567`, the head of the profile branch).
The same commit is passed as `engine-commit`, and the engine checks both
against GitHub's OIDC claims. The engine takes the repository and the issue
from the workflow context, never from the issue text.

## The sandbox profile

- **Documentation only.** No setup or verify commands, no commands for the
  agent, so nothing is installed and no target code runs. Verification is
  the engine's own built-in checks: `patch-not-empty`, `writable-paths`,
  `markdown-files`. None passes on an empty change.
- **One writable file:** `SANDBOX_PROBE.md`. A plan or patch that names any
  other path stops (`protected_surface` at plan time, rejected patch at
  develop time). The engine also protects `.github/**` (these workflows and
  the profile), `CODEOWNERS` and the agent configuration; the profile adds
  `README.md`.
- **Limits:** one file, 50 changed lines.

## Installing it (the owner, by hand)

Nothing in this folder is pushed to the sandbox automatically. Before the
first run the owner:

1. copies these files into the sandbox's default branch;
2. installs the pipeline GitHub App on the sandbox (issues, contents and
   pull requests: write; no `workflows` permission);
3. sets the secrets `CLAUDE_CODE_OAUTH_TOKEN` and `PIPELINE_APP_PRIVATE_KEY`
   and the variables `PIPELINE_BOT_LOGIN` and `PIPELINE_APP_CLIENT_ID`;
4. once the engine branches are merged, moves the pin (every `@<commit>` and every
   `engine-commit` in the two workflows) to the merge commit on `main`, so it can never be
   garbage-collected with a deleted branch.

Then a test issue goes to `stage:qualified` (spec and plan), and the bot
sets `stage:planned` (develop, then a draft PR). The sandbox has no router:
a problem stays at `stage:routing` with an outcome note until a person
acts. Only a person can mark the PR ready, approve and merge it.

`pnpm test:pipeline` checks this folder (`connector-sandbox.test.mjs`): the
pins, the permissions and secrets each call gets, and the profile against
the engine's policy and checks, with positive and negative cases.
