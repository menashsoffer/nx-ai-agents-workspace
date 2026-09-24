# pipeline-map

Generates [`docs/pipeline-map.md`](../../docs/pipeline-map.md): a Mermaid map
of every path through the issue → PR pipeline, plus workflow and
comment-marker tables and computed findings. GitHub renders it natively,
including on mobile.

```sh
pnpm pipeline:map        # regenerate docs/pipeline-map.md
pnpm pipeline:map:check  # exit 1 if it is stale (part of pnpm verify)
```

Nx targets: `generate`, `check`, `test`, `lint`, `typecheck`.

## Sources

| Source                             | What it contributes                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/*.yml`          | Parsed with `yaml`: name, `on:` triggers, label gates from job `if:`, every `pipeline.mjs <command>` in `run:` steps, `gh pr create` and `git push`         |
| `.github/scripts/pipeline-lib.mjs` | Imported directly: `STAGES`, `MARKERS`, `FIX_LOOP_*`, and `COMMAND_EFFECTS`, which says what each command writes (checked against `pipeline.mjs` by a test) |
| [`src/config.mjs`](src/config.mjs) | `EXPECTED_UNGATED`: stages that are set but have no label gate on purpose, and why                                                                          |

Nothing is special-cased per workflow or stage: a new stage, workflow or
command shows up on the map as soon as the sources mention it. A new
`pipeline.mjs` command that writes a stage or marker must be added to
`COMMAND_EFFECTS`, or `pnpm test:pipeline` fails.

## How edges are derived

- **label → workflow:** `github.event.label.name == '<label>'` (or
  `startsWith(...)`) in a job's `if:`.
- **workflow → stage:** `set-stage`/`edit-labels` arguments and
  `COMMAND_EFFECTS[cmd].stages`. A write is an **escalation** (red, dashed)
  when it comes right after a `notice` comment in the same step, or is listed
  in `COMMAND_EFFECTS[cmd].problems`.
- **workflow → workflow:** `gh pr create` / `git push` → workflows on
  `pull_request` (matching `types`); `COMMAND_EFFECTS[cmd].emits` →
  workflows on that event; `workflow_run` by workflow name.
- **fix loop:** `COMMAND_EFFECTS[cmd].loops`, ending at the command's problem stage.
- **humans:** a stage that is gated but never set is a human entry; `EXPECTED_UNGATED`
  entries of kind `triage` lead into it and kind `human` lead out to a human.

## Tests

`pnpm nx test pipeline-map`. The fixture tree in `src/fixtures/basic` (three
mini workflows and a fake `pipeline-lib.mjs`) must render exactly
`src/fixtures/basic/expected.md`; after an intended output change, run
`UPDATE_FIXTURES=1 pnpm nx test pipeline-map` and review the diff.
