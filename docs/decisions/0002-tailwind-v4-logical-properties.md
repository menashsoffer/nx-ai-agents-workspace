# 0002. Tailwind v4 with logical-property utilities only

- Status: accepted
- Date: 2026-09-22

## Context

Most sites built from this template are Hebrew RTL, while shared components
should also work LTR.

## Decision

Style with Tailwind v4. Design tokens live in `libs/ui/src/styles.css`
(`@theme`), and every app imports that file. Only logical utilities are
allowed (`ms/me`, `ps/pe`, `start/end`, `text-start/end`, ...); ESLint rejects
physical ones.

## Consequences

- Components flip automatically with `dir`.
- The lint rule matches class strings in TSX, so classes built dynamically from
  fragments (for example `'m' + side`) can slip past it. Avoid building class
  names that way.
