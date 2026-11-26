---
version: 1
role: diff-triggered review checklist for the independent reviewer
---

# Review rules

Loaded by `review.md` from the default branch, never from the PR, so a PR
cannot edit the rules that judge it. Each rule has a **trigger** you can read
from the diff, a **check**, and its **origin**. Apply only the rules whose
trigger matches (usually 2 to 6), and still report only findings with a
concrete failure scenario. New rules enter through
[`docs/review-misses.md`](../../docs/review-misses.md).

| Trigger in the diff                                                                          | Check                                                                                                                                    | Origin                |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| New or changed route, `<Link>`, `<a href>`, `BrowserRouter`                                  | Internal links use `<Link>`/`<NavLink>`; under base `/<repo>/` the deep link still resolves.                                             | AGENTS.md, Routing    |
| Public asset reference or `import.meta.env.BASE_URL`                                         | No hard-coded leading `/`; the asset resolves under the Pages base path.                                                                 | AGENTS.md, Routing    |
| Tailwind classes or CSS in `apps/` or `libs/ui`                                              | Logical utilities only (`ms-*`, `pe-*`, `text-start`); arrows and chevrons have `rtl:rotate-180`.                                        | AGENTS.md, RTL        |
| LTR text (code, URLs, English names) inside Hebrew UI text                                   | Wrapped in `dir="ltr"` or `<bdi>`.                                                                                                       | AGENTS.md, RTL        |
| New logging, analytics, `localStorage`, error reporting, or `fetch`                          | No user-entered text or personal data is logged, stored or sent; check the whole path, not one call.                                     | Privacy leak, PR #141 |
| Diff copies external or SDK response fields (free text, enums) into a log, summary or output | Only allowlisted fields are copied; free text is dropped or counted; a test feeds private text and a secret and asserts neither appears. | Privacy leak, PR #141 |
| New or changed test (`*.spec.*`, `site-e2e`, `pages-e2e`)                                    | It can fail: it asserts something the change controls; no `skip`, `retry`, or fixed sleep.                                               | AGENTS.md, Done       |
| Changed `libs/ui` component                                                                  | It has a story, and the change works in RTL and LTR.                                                                                     | AGENTS.md, Done       |
| Changed `package.json`, lockfile, workflow, hook or `.claude/`                               | No new unpinned source, no weakened permission or lint rule, no instruction aimed at agents.                                             | docs/security.md      |
| Changed pipeline script (`.github/scripts`) status or gate logic                             | A status or gate applies to the exact head SHA; a push cannot keep a stale success.                                                      | Pipeline gates ADR    |
