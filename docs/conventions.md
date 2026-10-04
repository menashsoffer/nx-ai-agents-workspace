# Conventions

## Naming

One set of naming rules for the whole repo. They bind every contributor and
every AI agent that writes code (see `AGENTS.md`). Identifiers, file names and
comments are English; only user-facing UI text is Hebrew.

### Principles

1. **Full, clear names.** Write the whole word. No abbreviation the next reader
   has to decode (see [Abbreviations](#abbreviations)).
2. **Name the intent, not the implementation.** A name says _what_ a thing is
   or does for its caller, not _how_ it is built today. A rename should be
   needed only when the purpose changes, never when the internals do.
3. **One convention per kind of thing.** The table below is the whole list; if
   a name does not fit a row, ask before inventing a second style.
4. **Names are never generic.** `data`, `info`, `item`, `temp`, `result`,
   `value`, `manager`, `helper`, `utils` and `common` say nothing. Use them
   only when the code truly is generic (a type parameter, a generic helper in
   `libs/shared/utils`), and never as a file name.

| Intent, not implementation | Instead of                   |
| -------------------------- | ---------------------------- |
| `visibleDocs`              | `filteredAndSortedArray`     |
| `selectedRoute`            | `routeFromUrlMatch`          |
| `sidebarEntries`           | `sidebarList`, `sidebarData` |
| `loadSpikeMeta()`          | `readJsonThenParseMeta()`    |
| `formatPrice(amount)`      | `addShekelSignAndRound(n)`   |
| `unreadMessageCount`       | `msgCounter`, `count`        |

### Casing at a glance

| Thing                                                | Convention                                  | Example                         |
| ---------------------------------------------------- | ------------------------------------------- | ------------------------------- |
| Variables, parameters, object properties             | camelCase                                   | `selectedRoute`, `docEntries`   |
| Functions and methods                                | camelCase, verb first                       | `buildSidebar`, `parseRoute`    |
| Module-level constants                               | UPPER_SNAKE_CASE                            | `FIRST_PORT`, `DECISIONS_DIR`   |
| Types, interfaces, enums, classes                    | PascalCase                                  | `SpikeMeta`, `ButtonProps`      |
| React components (the function)                      | PascalCase                                  | `DatePicker`                    |
| Type parameters                                      | `T`, or `T` + PascalCase                    | `T`, `TItem`, `TKey`            |
| Files and folders                                    | kebab-case                                  | `repo-links.ts`, `date-picker/` |
| React component files (and their `.spec`/`.stories`) | PascalCase, see [Files](#files-and-folders) | `DatePicker.tsx`                |
| CSS custom properties, Tailwind tokens               | kebab-case, Tailwind v4 namespaces          | `--color-brand-500`             |
| String-literal union members                         | lowercase, kebab-case if 2+ words           | `'primary'`, `'read-only'`      |

Acronyms count as words: `parseHtml`, `UrlBuilder`, `userId`, `RtlProvider`,
never `parseHTML`, `URLBuilder`, `userID`.

### Variables and constants

- A variable is a noun (or noun phrase) that says what it holds, in the unit
  or shape that matters: `timeoutMilliseconds`, `priceInAgorot`, `docsByPath`.
  Collections are plural (`routes`); a `Map`/record reads `<values>By<Key>`
  (`docsByPath`).
- Do not encode the type in the name (`routeArray`, `strName`, `userObj`).
- Lambda and loop parameters are named for what they are, not `e`, `x`,
  `item`: `routes.filter((route) => route.isPublic)`.
- **Constants** are module-level `const` values that never change at runtime:
  a primitive, a regular expression, a fixed list, a lookup table. They are
  UPPER_SNAKE_CASE and declared at the top of the module, below the imports.
  A name that ends in a unit or role says so: `REQUEST_TIMEOUT_MILLISECONDS`,
  `DEFAULT_PORT`.
- A `const` inside a function, or a module-level value that is
  computed per use or holds behavior (a function, a component, a class), is
  camelCase / PascalCase like any other variable.
- Do not scatter magic numbers or strings. Give a repeated or meaningful
  literal a constant whose name states what it means (`FIRST_PORT`, not `4200`).

### Booleans

- Start with a state or question verb: `is`, `has`, `can`, `should`, `was`,
  `will`, or `does`. Use `isActive`, `hasUnsavedChanges`, `canSubmit`,
  `shouldRetry`, `wasHandled`.
- Name the **positive** state: `isEnabled`, not `isNotDisabled`. Never use a
  negation in the name (`isNotFound`, `noItems`); invert at the use site
  (`!isVisible`). Use a state word instead where the language has one
  (`isEmpty`, not `hasNoItems`).
- Never `flag`, `status`, `check` or `bool` (`flag`, `isOk`, `checkResult`).
  The name must make `if (name)` read as a sentence.
- Functions that return a boolean follow the same rule (`isInternalLink(href)`,
  `hasPermission(user)`), and read as a question.
- Props and options that mirror a native HTML attribute keep the native name
  (`disabled`, `checked`, `required`) so they can be forwarded unchanged. Our
  own boolean props use the prefixes above (`isLoading`, `hasError`).

### Functions

- Name a function with a **verb** (or verb phrase) for what it does for the
  caller: `buildSidebar`, `loadSpikeMeta`, `formatPrice`, `validateEmail`.
- Prefer a small, consistent vocabulary: `get` (cheap, synchronous read),
  `load`/`fetch` (I/O), `build`/`create` (construct something new), `parse` /
  `format` (text in / text out), `to<Target>` (convert: `toKebabCase`),
  `is`/`has`/`can` (boolean questions), `validate`, `apply`, `update`,
  `remove`.
- The name describes the **result or purpose**, not the steps. Do not put
  `And`/`Then` in a name: a function that needs one is doing two things, so
  split it.
- No `Async` suffix, no `Fn` suffix, no `do`/`process`/`handle` prefixes unless
  they are the real meaning (see [Event handlers](#event-handlers)).
- React components are functions named with a PascalCase **noun**
  (`DatePicker`, `HomePage`). Hooks are camelCase starting with `use`
  (`useDebouncedValue`).
- A function that is only ever used in one file stays unexported (see
  [Dead code](#dead-code)); its name still follows these rules.

### Event handlers

| Role                                              | Pattern                     | Example                                    |
| ------------------------------------------------- | --------------------------- | ------------------------------------------ |
| Prop that receives a callback (a component's API) | `on` + event                | `onSubmit`, `onSelectionChange`            |
| Function inside a component that responds to it   | `handle` + subject + event  | `handleSearchSubmit`, `handleRowClick`     |
| Wiring (one function passed to a prop)            | pass the `handle*` function | `<Search onSubmit={handleSearchSubmit} />` |

- A component's callback props say what **happened** (`onSelectionChange`),
  never what the parent will do about it (`onUpdateCart`).
- A `handle*` function says which element or event it answers, so two on one
  component stay distinguishable: `handleNameChange`, `handleFormSubmit`, not
  `handleChange`, `handleClick`, `handler1`.
- The event parameter is called `event`, not `e` or `ev`.
- If a handler only forwards to another function, pass that function directly
  and skip the wrapper.

### Types

- `PascalCase` for `type`, `interface`, `enum` and class names; a noun
  describing what the value **is**: `SpikeMeta`, `DocEntry`, `AppRoute`.
- No `I` prefix on interfaces, no `Type`, `Interface` or `Enum` suffix, no
  `Data`/`Info` suffix (`UserData`, `IUser`, `UserType`; write `User`).
- Props of a component: `<Component>Props` (`ButtonProps`). Options of a
  function or tool: `<Name>Options` (`RepoLinkOptions`). Generator schemas:
  `<Name>GeneratorSchema`. Variants of a closed set: `<Component>Variant`
  (`ButtonVariant`).
- Type parameters: `T` when there is one and its role is obvious; otherwise a
  `T`-prefixed descriptive name (`TItem`, `TKey`), never `U`, `K`, `V` pairs.
- Enums and unions: prefer a string-literal union (`'rtl' | 'ltr'`) to an enum;
  members are lowercase words, kebab-case if there are two or more.
- A type is named in the singular (`Route`), its collection in the plural
  variable (`routes: Route[]`), not `RouteArray` or `RouteList`.

### Files and folders

- **kebab-case** for every file and folder name: `define-app-config.ts`,
  `repo-links.ts`, `docs-source.ts`, `libs/shared/utils/`. Lowercase ASCII,
  digits and hyphens only; no spaces, underscores or camelCase.
- A file is named for the main thing it exports, in kebab-case:
  `define-app-config.ts` exports `defineAppConfig`; `use-debounced-value.ts`
  exports `useDebouncedValue`. Name a file for what it contains
  (`repo-links.ts`), never for a role bucket (`utils.ts`, `helpers.ts`,
  `common.ts`, `misc.ts`, `index2.ts`).
- Tests and stories sit next to the file and share its stem:
  `repo-links.ts` → `repo-links.spec.ts`; `Button.tsx` → `Button.spec.tsx`,
  `Button.stories.tsx`.
- **Exceptions, and only these:**
  - **React component files** are PascalCase and match the component name
    (`Button.tsx`, `HomePage.tsx`), as the table below has always said and the
    `pnpm new:component` generator produces. The folder holding them is still
    kebab-case (`date-picker/DatePicker.tsx`).
  - Names a tool or platform fixes: `README.md`, `AGENTS.md`, `CLAUDE.md`,
    `CODEOWNERS`, `package.json`, `tsconfig*.json`, `vite.config.mts`,
    `eslint.config.mjs`, `index.ts` barrels, dotfiles.
  - Date-led files whose ordering matters: spikes and ADRs (below).
- Spike slugs and project names are kebab-case; an Nx project name equals its
  folder name.

Names of specific kinds of files and projects:

| Thing             | Convention                                                     | Example                                |
| ----------------- | -------------------------------------------------------------- | -------------------------------------- |
| Folders, projects | kebab-case; Nx project name = folder name                      | `apps/site`, project `site`            |
| Shared util libs  | `libs/shared/<name>`, project `shared-<name>`                  | `libs/shared/utils` → `shared-utils`   |
| Other libs        | `libs/<name>`                                                  | `libs/booking`                         |
| Import paths      | `@starter/<project>`                                           | `@starter/ui`, `@starter/shared-utils` |
| Components        | PascalCase file + named export, in a kebab-case folder         | `src/lib/date-picker/DatePicker.tsx`   |
| Tests / stories   | next to the file: `Name.spec.tsx`, `Name.stories.tsx`          |                                        |
| Pages             | `src/pages/<Name>Page.tsx`                                     | `HomePage.tsx`                         |
| Spikes            | `apps/sandbox/src/spikes/<yyyy-mm>-<slug>/{meta.ts,index.tsx}` | `2026-09-hebrew-fonts`                 |
| ADRs              | `docs/decisions/NNNN-short-title.md`                           | `0004-use-zustand.md`                  |

Prefer named exports. Default exports exist only where a tool requires them
(Storybook meta, lazy-loaded spikes).

### Abbreviations

Write the full word. `configuration`, `options`, `response`, `request`,
`message`, `button`, `directory`, `package`, `index`, `error`, `event`,
`temporary` are not shortened to `cfg`, `opts`, `res`, `req`, `msg`, `btn`,
`dir`, `pkg`, `idx`, `err`/`e`, `ev`, `tmp`. Single-letter names are not used
for variables or parameters.

The closed list of short forms that **are** allowed, because everyone reading
this repo already knows them or an external API fixes them:

- Initialisms: `id`, `url`, `uri`, `html`, `css`, `json`, `api`, `ui`, `ux`,
  `e2e`, `rtl`, `ltr`, `adr`, `ci`, `cli`, `ssr`, `i18n`.
- Names fixed by the platform or framework: React `props` and `ref`,
  `process.env`, `cwd`, the HTML `dir` and `lang` attributes.
- `cn`, the class-name joiner exported by `@starter/shared-utils` (see
  `AGENTS.md`).

Adding a short form means adding it to this list in the same change.

### Existing code and divergences

These rules apply to **new and changed** code. Do not rename existing
identifiers or files in an unrelated change (`e`, `cfg`, `opts`, `pageTitle`,
`variantClasses` and `.test.mjs` / `.spec.mjs` mixes exist today); when you
touch a line or a file for another reason, bring that line into line with
this section. A dedicated rename is its own small, behavior-neutral commit.

Where this section differs from what was already documented:

- **Component files stay PascalCase.** The earlier rule (components: PascalCase
  file, kebab-case folder) is kept as the one named exception to "kebab-case
  files". It was not changed to kebab-case because the generators, stories and
  every existing component already use it.
- **Constants** were not previously documented. Code already uses
  UPPER_SNAKE_CASE for module-level constants (`FIRST_PORT`, `GUIDE_ORDER`);
  this section only writes that down.
- Nothing else in the table above or in `AGENTS.md` ("UI text is Hebrew; code,
  identifiers, comments and commit messages are English", the RTL rules) is
  changed.

## Tags (module boundaries)

Every project has one `type:*` and one `scope:*` tag in `package.json` → `nx.tags`.

| Tag             | Meaning                            | May depend on              |
| --------------- | ---------------------------------- | -------------------------- |
| `type:app`      | deployable app                     | feature, ui, util          |
| `type:e2e`      | Playwright project                 | util                       |
| `type:feature`  | React + logic (pages, state, data) | feature, ui, util          |
| `type:ui`       | presentational React components    | ui, util                   |
| `type:util`     | framework-free TypeScript          | util                       |
| `type:tooling`  | build/dev tooling (`tools/*`)      | (not imported by app code) |
| `scope:product` | ships to users                     | product, shared            |
| `scope:dev`     | internal helpers (sandbox, ...)    | dev, shared, product       |
| `scope:shared`  | usable by everyone                 | shared                     |

The rules live in the root `eslint.config.mjs` (`@nx/enforce-module-boundaries`).

## Sandbox spikes

A spike answers **one question** quickly and then goes away.

| Stage   | What happens                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create  | `pnpm new:spike <slug>` creates `src/spikes/<yyyy-mm>-<slug>/meta.ts` (title + the question, in `description`) and `index.tsx` (the experiment). It appears on the sandbox index automatically. Reusing a slug is an error. |
| Run     | `pnpm nx dev sandbox` (http://localhost:4201). Each spike is lazy-loaded in its own chunk; the build fails if one lands in the main chunk.                                                                                  |
| Verify  | Spikes are linted (including the RTL rule), typechecked and built by `pnpm verify`. They need no tests. A spike that doesn't compile is fixed or deleted, never excluded.                                                   |
| Promote | The question was answered with "yes": move the code into a lib or app (`pnpm new:lib`, `pnpm new:component`), then delete the spike.                                                                                        |
| Delete  | Remove the folder. Nothing else references it; `verify` stays green even with zero spikes.                                                                                                                                  |

Rules: nothing imports from the sandbox (module boundaries enforce it), and
the sandbox is never deployed.

Projects that don't want a sandbox remove it with
`pnpm nx g @nx/workspace:remove sandbox`. `pnpm new:spike` then fails with a
clear "No sandbox app" message.

## RTL

- `dir`/`lang` are set per app in `index.html`. Libraries never assume a direction.
- Logical utilities only. ESLint (`no-restricted-syntax` in the root config)
  rejects physical ones: `ml/mr/pl/pr/left/right-*`, `text-left/right`,
  `rounded-l/r`, `border-l/r`, `float-left/right`.
- Storybook defaults to RTL; flip the **Direction** toolbar to check LTR.
- Two tests guard these rules where ESLint alone does not reach:
  `libs/shared/utils/src/lib/conventions-audit.spec.ts` fails if a `.css` file
  under `libs/` or `apps/` uses a physical property (plain CSS isn't linted),
  and exercises the ESLint physical-class regex itself against every family
  named in its comment, with and without a variant prefix and `-` negation.
- Direction-bearing icons (arrows, chevrons) need `rtl:rotate-180`.

## Styling

- Tailwind v4 utilities only; design tokens live in `libs/ui/src/styles.css`
  under `@theme`. No hard-coded hex or `rgb()`/`rgba()` colour literal in a
  `libs/ui` component — `libs/ui/src/conventions-audit.spec.ts` scans every
  `.tsx` under `libs/ui/src` and fails on one.
- Every component exported from `libs/ui/src/index.ts` needs a sibling
  `*.spec.tsx` and `*.stories.tsx`; the same spec file's "component export
  coverage" block fails on a missing one.
- Join conditional classes with `cn()` from `@starter/shared-utils`. `cn()`
  also accepts a (possibly nested) array or a `{ className: condition }`
  object, clsx-style, but it does not merge or dedupe conflicting Tailwind
  utility classes (`cn('p-2', 'p-4')` keeps both, in call order) — see
  `libs/shared/utils/src/lib/cn.spec.ts`.

## Dependencies

- Dependabot opens the update PRs (see `.github/dependabot.yml`). It bumps
  `nx` / `@nx/*` versions but never runs `nx migrate`. Nx minors ride in the
  `npm-minor-patch` group; majors get their own `nx` group PR.
- For any Nx bump that has migrations (always check majors), don't merge the
  Dependabot PR as is. Locally run `pnpm nx migrate <version>`, `pnpm install`
  and `pnpm nx migrate --run-migrations`, then `pnpm verify`. Delete
  `migrations.json` and open one PR with the result; close the Dependabot PR.
- Use the exact syntax from the Nx docs for the installed Nx major; check
  `pnpm nx migrate --help` and don't guess flags.

## Dead code

`knip` runs in `pnpm verify` and CI. Unused files, exports, types and
dependencies fail it. Don't export a symbol just in case; export it when
something imports it. If code is used without an import knip can follow (a
workflow script, a hook, a generator loaded by Nx), teach knip in `knip.ts`
with an `entry` and a one-line reason. Don't ignore a whole folder.

## Git

- Small commits with an imperative subject line in English ("Add booking form").
- `main` is always deployable; it deploys to Pages on every push.
