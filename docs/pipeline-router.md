# Router

## Router

### Outcome notes

Every stage appends one comment per run to the issue (spec, plan,
develop, pr) or PR (approval, ci). It is never edited or upserted,
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

`stage` is one of `spec` (legacy: notes written before spec and plan merged), `plan`, `develop`, `approval`, `ci`, `pr`;
`result` is `success` or `problem`. On success the stage moves to its next
label itself (no extra run). On a problem it sets `stage:routing`.
`pipeline.mjs outcome <n> <file.json>` posts a note;
`pipeline.mjs classify <stage> ...` turns job results and agent output into
one. Agent text in a note is flattened to single lines and cannot contain `<!--`, so it cannot
forge a marker.

### Problem codes (`PROBLEMS`)

| Code                        | Reported by   | Meaning                                                                                                                                      |
| --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_output`            | plan          | The agent answered, but not in the required shape (plan: a required spec or plan section is missing)                                         |
| `agent_error`               | plan, develop | The run failed: API/quota/timeout, empty output, no changes                                                                                  |
| `spec_missing`              | _legacy_      | Old plan-stage note: no spec comment. Still read, no longer written                                                                          |
| `spec_questions`            | plan          | The issue is unclear (blocking questions), or a criterion is not testable                                                                    |
| `untestable_criteria`       | _legacy_      | Old plan-stage note: criteria untestable. Still read, no longer written                                                                      |
| `verify_failed`             | develop       | `pnpm verify` could not be made green                                                                                                        |
| `plan_gap`                  | develop       | The plan is wrong or incomplete                                                                                                              |
| `copilot_request_failed`    | approval      | The Copilot review could not be requested (`REQUIRE_COPILOT` on)                                                                             |
| `ci_failed`                 | ci            | CI failed on a pipeline PR's current head (`ci-failed.yml`)                                                                                  |
| `pr_closed`                 | pr            | The issue's PR was closed without merging and no other open PR is linked (`done.yml`)                                                        |
| `protected_surface`         | plan, develop | **Gate.** The work touches a never-approvable path (`tools/security/`, `.github/`, `CODEOWNERS`, ...) or supply-chain settings               |
| `protected_approval_needed` | develop       | **Gate.** The branch is pushed with no PR and the owner is asked (an outcome note, not routed; the issue waits in `stage:awaiting-approval`) |
| `protected_rejected`        | develop       | The owner rejected the protected changes (`/reject-protected`). Routes to a human; the branch is kept                                        |
| `needs_secrets_ci_infra`    | plan, develop | **Gate.** Needs secrets, CI/workflow changes, infra, a server                                                                                |
| `scope_split`               | plan          | Bigger than size L, or over the auto-approval size limits; split the issue (routes to a human)                                               |
| `embedded_instructions`     | plan          | **Gate.** The issue contains instructions aimed at the agents                                                                                |
| `forbidden_path`            | develop       | **Gate.** `check-patch` rejected the patch: a never-approvable path, or a header it cannot parse                                             |

### Rules table (`decideByRules`)

| Stage    | Problem                                                | Target                                                    |
| -------- | ------------------------------------------------------ | --------------------------------------------------------- |
| spec     | `invalid_output`                                       | re-plan (legacy note; `stage:qualified`)                  |
| spec     | `agent_error`                                          | human: "the old spec stage failed, see run"; no loop used |
| plan     | `agent_error`, `invalid_output`                        | re-plan (`stage:qualified`)                               |
| plan     | `spec_questions`, `scope_split`                        | human                                                     |
| plan     | `spec_missing`, `untestable_criteria`                  | re-plan (legacy notes only)                               |
| develop  | `verify_failed`, `agent_error`                         | re-develop (`stage:planned`)                              |
| develop  | `plan_gap`                                             | re-plan (`stage:qualified`)                               |
| develop  | `protected_rejected`                                   | human (the branch is kept for the owner to decide)        |
| approval | `copilot_request_failed`                               | human                                                     |
| ci       | `ci_failed`                                            | human                                                     |
| pr       | `pr_closed`                                            | human only; never retried (the close was deliberate)      |
| any      | hard gate, anything unlisted, or no valid outcome note | human                                                     |

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
  re-develop 1, and 5 routed rounds in total per item.
  Rounds are counted from the bot's route notes after the latest `restart`
  note (the owner's `/restart`, see [When it stops](pipeline-running.md#when-it-stops-at-stageneeds-attention));
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

- **CI failure retry.** `ci_failed` goes to a human; nothing retries it.
