# ui

Shared React components and design tokens (Tailwind v4). Import as
`@starter/ui`; import the stylesheet once per app with
`@import '@starter/ui/styles.css';`.

- `pnpm storybook` browses components (RTL by default, LTR via the toolbar).
- `pnpm nx test ui` runs the unit tests.
- Every component ships with `Name.tsx`, `Name.stories.tsx` and `Name.spec.tsx`
  in `src/lib/<name>/`, and is exported from `src/index.ts`.
