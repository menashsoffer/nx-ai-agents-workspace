# workspace-plugin

Local Nx generators that encode this workspace's conventions. Use them (or the
root `pnpm new:*` scripts) instead of the stock `@nx/react` generators.

| Command                                        | Creates                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm new:app <name> [--scope=dev\|product]`   | `apps/<name>`: Vite + React Router + Tailwind via `ui` styles, RTL shell, next free port  |
| `pnpm new:lib <name> --type=util\|ui\|feature` | `libs/<name>` (or `libs/shared/<name>` for shared utils), tagged for module boundaries    |
| `pnpm new:component <name> [--project=ui]`     | `src/lib/<name>/<Name>.tsx` + `.spec.tsx` (+ `.stories.tsx` if the project has Storybook) |
| `pnpm new:spike <name>`                        | `apps/sandbox/src/spikes/<yyyy-mm>-<name>/index.tsx`, auto-listed in the sandbox          |

Add `--dry-run` to any command to preview the files.

`generators.json` points at `src/` so Nx runs the generators straight from
TypeScript without a build. To publish the plugin to npm later, point it at
`dist/` and run `pnpm nx build workspace-plugin`.

Tests: `pnpm nx test workspace-plugin` (they run the real Nx generators
against an in-memory workspace shaped like this repo).
