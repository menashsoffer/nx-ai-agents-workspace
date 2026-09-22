# Copilot instructions

Follow [`AGENTS.md`](../AGENTS.md) at the repository root. It is the single
source of truth for architecture, commands, and rules in this repo, shared by
all AI assistants.

The essentials:

- Run `pnpm verify` before considering a change done.
- Create apps, libs, components and spikes with `pnpm new:app|lib|component|spike`.
- UI is Hebrew RTL: use logical Tailwind classes only (`ms-*`, `pe-*`,
  `text-start`, ...), never `ml-*`, `pr-*`, `text-right`, `left-*`.
- Respect module boundaries: product code (`scope:product`) never imports `scope:dev`.
