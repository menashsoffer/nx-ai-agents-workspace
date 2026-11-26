# Feature map (site)

The user-visible features of `apps/site`, written from the user's point of
view. It is the rubric for end-to-end checks: a feature is done when its
"expected result" holds in a real browser. When you add or change a route or a
user flow, update this table and the spec that covers it (`apps/site-e2e/src`).
A row with no spec is a known gap; say so in the PR.

| Feature              | Path / selector                                | Expected result                                                                 | Covered by                              |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| RTL Hebrew shell     | every page, `html`                             | `lang="he"`, `dir="rtl"`, banner, main and the `ראשי` navigation are visible    | `site.spec.ts`, `accessibility.spec.ts` |
| Home page            | `/`, h1                                        | One h1 `NX AI Pipeline`; Hebrew welcome text                                    | `site.spec.ts`                          |
| Main navigation      | `nav[aria-label="ראשי"]`, links `בית`, `אודות` | Active link has `aria-current="page"`; clicking changes URL and h1              | `navigation.spec.ts`                    |
| About page           | `/about`                                       | h1 `אודות`; content mentions page routing                                       | `about.spec.ts`                         |
| Browser history      | back / forward after in-app navigation         | Each step shows the right page                                                  | `navigation.spec.ts`                    |
| Deep link and reload | `/about` opened directly, then reloaded        | Renders the about page, not a 404                                               | `navigation.spec.ts`                    |
| Not-found page       | `/no-such-page`, `/a/b/c`                      | h1 `הדף לא נמצא`; link `חזרה לדף הבית` goes to `/`                              | `site.spec.ts`, `navigation.spec.ts`    |
| Code map link        | home, link `מפת קוד`                           | Opens `/code-map/` in a new tab, with `rel` set and a screen-reader hint        | `site.spec.ts`, `accessibility.spec.ts` |
| Phone layout         | Pixel 7 viewport                               | No horizontal scroll; navigation reachable; layout stays RTL                    | `mobile.spec.ts`                        |
| Keyboard access      | Tab through the navigation                     | Links are reachable and activate with Enter                                     | `accessibility.spec.ts`                 |
| Accessible names     | every page                                     | No unnamed link or button; every `img` has an `alt`; non-empty document title   | `accessibility.spec.ts`                 |
| Page health          | every page                                     | No broken image, console error or uncaught page error                           | `page-health.spec.ts`                   |
| `התחילו כאן` button  | home, `Button`                                 | Not specified: the button has no action yet. Add a row and a spec when it does. | none (gap)                              |
| Base path (Pages)    | deployed artifact under `/<repo>/`             | Links, assets and deep links keep the base path                                 | `pages-e2e`, `App.spec.tsx`             |
