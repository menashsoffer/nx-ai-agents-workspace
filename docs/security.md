# Security standard

This template and every project created from it follow the controls below.
**Gate** = CI fails the PR. **Review** = checked by a person at merge (or once,
as a repo setting).

Run the gates locally with `pnpm security` (and `pnpm verify` for D3). Exit
codes: `0` passed, `1` a gate failed, `2` **not run** (unsupported platform).
Never treat `2` as passed; CI is authoritative.

## 1. Dependencies and supply chain

| #    | Requirement                                                                                                                                       | Enforced by                                    | Type   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| D1   | No high/critical advisory in production dependencies                                                                                              | `pnpm security` (pnpm audit `--prod`)          | Gate   |
| D2   | Derived projects: high/critical dev-dependency advisories are reported; fix, override or add an exception within 14 days of first appearing in CI | `pnpm security` (warning)                      | Review |
| D2-T | **Template repo only:** high/critical advisories in _any_ dependency fail                                                                         | `pnpm security` (while `template:init` exists) | Gate   |
| D3   | Every declared dependency is used                                                                                                                 | `knip --dependencies` in `pnpm verify`         | Gate   |
| D4   | Reproducible installs: `--frozen-lockfile` in CI, deploy and the SessionStart hook; `packageManager` pins pnpm with its integrity hash            | CI install step, corepack                      | Gate   |
| D5   | Install scripts are allow-listed: `strictDepBuilds: true`; every package with build scripts is in `allowBuilds` (reasons below)                   | pnpm install fails otherwise                   | Gate   |
| D6   | No versions published less than 3 days ago: `minimumReleaseAge: 4320`                                                                             | pnpm config                                    | Gate   |
| D7   | Dependabot for npm (weekly, grouped, 7-day cooldown) and GitHub Actions                                                                           | `.github/dependabot.yml`                       | Review |
| D8   | Each `overrides` entry has an advisory ID and a removal condition                                                                                 | comment in `pnpm-workspace.yaml`               | Review |

### D5: build-script decisions

| Package            | Scripts run? | Why                                                                            |
| ------------------ | ------------ | ------------------------------------------------------------------------------ |
| `@swc/core`        | yes          | Downloads its native binary; Nx and the generators use it                      |
| `esbuild`          | yes          | Verifies/installs its native binary; used by Vite and Storybook                |
| `nx`               | yes          | Installs Nx's native module                                                    |
| `@parcel/watcher`  | no           | Optional native watcher (Storybook); falls back without it                     |
| `simple-git-hooks` | no           | Its postinstall would install hooks; the root `prepare` script does it instead |
| `unrs-resolver`    | no           | Ships prebuilt binaries; the postinstall is only a fallback build              |

### Overrides (D8)

| Package     | Override  | Advisory            | Remove when                          |
| ----------- | --------- | ------------------- | ------------------------------------ |
| `smol-toml` | `>=1.7.1` | GHSA-7w5x-hrqm-74c2 | `nx` depends on `smol-toml` >= 1.7.1 |

## 2. GitHub Actions workflows

| #   | Requirement                                                                                                                                       | Enforced by                | Type   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------ |
| W1  | Top-level `permissions: contents: read` (or `{}`); broader scopes only per job; write scopes only on publish jobs (gh-pages, pipeline App tokens) | zizmor                     | Gate   |
| W2  | Every `uses:` is pinned to a full commit SHA with a `# vX.Y.Z` comment (local `./` workflows exempt)                                              | zizmor                     | Gate   |
| W3  | `persist-credentials: false` on every checkout                                                                                                    | zizmor                     | Gate   |
| W4  | No `${{ }}` expressions inside `run:`; pass values through `env:`                                                                                 | zizmor                     | Gate   |
| W5  | No `pull_request_target` / artifact-consuming `workflow_run` (`security.yml` is a reviewed, artifact-free `workflow_run`)                         | zizmor                     | Gate   |
| W6  | `gh-pages` is written only by `deploy.yml` (main) and `preview.yml` (`pr-*/`); deploy `concurrency` never cancels                                 | workflow + review          | Review |
| W7  | Workflows are valid                                                                                                                               | actionlint                 | Gate   |
| W8  | Every job has `timeout-minutes`                                                                                                                   | actionlint/zizmor + review | Gate   |

zizmor runs **online in CI** (it can then detect impostor commits behind
pinned SHAs) and **offline locally**. `.github/zizmor.yml` disables exactly one
audit, `self-repository`: a style suggestion (not W1-W5) for the `$/...` reusable
workflow syntax, which actionlint 1.7.12 (W7) rejects. Re-enable it when both
tools agree.

Workflows install pnpm through corepack from the hash-pinned `packageManager`
(D4), so no third-party setup Action is needed.

## 3. Secrets

| #   | Requirement                                                                          | Enforced by                      | Type   |
| --- | ------------------------------------------------------------------------------------ | -------------------------------- | ------ |
| S1  | No secrets in the tree or history                                                    | gitleaks (full history)          | Gate   |
| S2  | GitHub secret scanning + push protection enabled                                     | repo setting (release checklist) | Review |
| S3  | `.gitignore` covers `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`       | template smoke test              | Gate   |
| S4  | No secrets needed: workflows use only `GITHUB_TOKEN`/OIDC; a new secret needs an ADR | review                           | Review |

## 4. AI-assistant configuration

Every project inherits these files, so they are held to a higher bar.

| #   | Requirement                                                                                                                                                                             | Enforced by     | Type   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ |
| A1  | `.claude/settings.json` allow-list names specific subcommands only. Never `pnpm nx:*`, `pnpm exec:*`, `npx:*`, `Bash(*)`, or prefixes like `pnpm nx run` that also match `run-commands` | `pnpm security` | Gate   |
| A2  | Plugins are enabled only from marketplaces pinned to a tag (`ref: "vX.Y.Z"`); otherwise the marketplace is listed but the plugin is off                                                 | `pnpm security` | Gate   |
| A3  | MCP servers run from the lockfile (`pnpm exec …`): never `npx`/`dlx`/`@latest`, never remote URLs (`.mcp.json`, `.gemini/`, `.codex/`)                                                  | `pnpm security` | Gate   |
| A4  | The SessionStart hook only runs the frozen install and writes env vars; no downloads besides packages, never `curl … \| sh`                                                             | review          | Review |
| A5  | AGENTS.md forbids agents from changing workflows, `.claude/settings.json`, pnpm supply-chain settings or overrides without an explicit request                                          | review          | Review |

The Nx Claude plugin (`nx@nx-claude-plugins`) is listed but **not enabled**:
its marketplace (`nrwl/nx-ai-agents-config`) publishes no tags to pin. To use
it in a project, enable it in `.claude/settings.local.json` (personal, not
committed), or pin the marketplace with `"ref": "<tag>"` once tags exist.

## 5. Shipped site

| #   | Requirement                                                                                  | Enforced by                                | Type |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------ | ---- |
| P1  | No third-party runtime scripts or styles; every request is same-origin                       | `tools/pages` assemble check + `pages-e2e` | Gate |
| P2  | No source maps in the Pages artifact                                                         | `tools/pages` assemble check               | Gate |
| P3  | Header-based CSP is out of scope: GitHub Pages can't set headers. A `<meta>` CSP is optional | —                                          | —    |

## 6. Exceptions

A failing gate may be waived only by an entry in
[`tools/security/exceptions.json`](../tools/security/exceptions.json)
(shipped empty; `template:init` keeps it empty):

```json
[
  {
    "control": "D2",
    "target": "GHSA-xxxx-xxxx-xxxx",
    "reason": "Dev-only advisory in a Storybook dependency; fix pending upstream.",
    "owner": "@your-github-user",
    "created": "2026-09-22",
    "expires": "2026-11-01"
  }
]
```

- `control`: a control ID above. `target`: what is excepted (advisory ID for
  D1/D2/D2-T, otherwise the file/rule/package).
- `owner`: a GitHub `@user` or `@org/team`. Placeholders fail.
- `expires`: at most **90 days** after `created`. CI fails once it has passed.
- Advisory exceptions (D1/D2/D2-T) are applied by `pnpm security`
  automatically. For other controls, also add the tool's own suppression
  (e.g. a zizmor ignore comment) that references the exception.

Nothing may be disabled, skipped or loosened inline without an entry here.

## 7. Pinned security tools

`pnpm security` downloads actionlint, gitleaks and zizmor from
[`tools/security/tools.json`](../tools/security/tools.json) into
`.security-bin/`, verifying each archive's SHA-256. A mismatch deletes the
download and fails. There is no fallback to an unverified binary.

- If `tools.json` fails validation (https URLs, 64-hex hashes, review age),
  **nothing is downloaded or run** and the run fails.
- Downloads are https-only, including redirects (`file://` is accepted only
  by an explicit test-only option).
- The verified archive stays in the cache; every run re-hashes it and
  re-extracts the binary, so a tampered cached binary is never executed.

- **Supported platforms:** glibc Linux and macOS, x64 and arm64. Alpine/musl and
  native Windows exit with `2` (not run). **On Windows, use WSL2.**
- **Updating:** Dependabot can't update `tools.json`. Review it at least
  quarterly: bump the versions and hashes together (gitleaks and actionlint
  publish checksum files; zizmor doesn't, so compute its hashes from the
  release archives) and update `reviewed`. CI fails when `reviewed` is older
  than **120 days**.

## Post-merge release checklist (template repo)

1. S2: Settings → Code security → enable secret scanning + push protection.
2. W6: Settings → Pages → Source: Deploy from a branch, `gh-pages` / (root) (ADR 0004).
3. Settings → General → tick **Template repository** (last).
