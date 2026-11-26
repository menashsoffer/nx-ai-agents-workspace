# מדריך React לאתר: מבנה, כללים וצ'ק-ליסט לפרודקשן

המסמך קובע איך כותבים את האתר ב-React כך שיהיה מודולרי, קל לתחזוקה, מהיר ובטוח לעלייה לסביבת הייצור. הוא מחייב כל קוד חדש ב-`web/`, שנכתב בידי אדם, Claude או Codex.

עודכן: 16.11.2026. מעמד: מחייב, יחד עם [כללי הקוד](coding-standards-he.md). כשיש סתירה, כללי הקוד גוברים. הבחירות הטכנולוגיות כאן מתועדות בהחלטה [0006](decisions/0006-react-toolchain-he.md). חלוקת העבודה נמצאת ב[תוכנית העבודה](react-work-plan-he.md).

אין דרך להבטיח קוד "נקי מבאגים". מה שהמדריך כן מבטיח: כל כלל שאפשר לבדוק אוטומטית נבדק ב-CI, וכל השאר מופיע בצ'ק-ליסט שבסוף.

## 1. ארכיטקטורה ומבנה תיקיות

כשמחלקים קוד לפי סוג קובץ בלבד (`components/`, `hooks/`, `pages/`), קוד של נושא אחד מתפזר בכל הריפו, וקשה לשנות או למחוק נושא בלי לשבור אחר. לכן האתר בנוי לפי פיצ'רים, בהשראת [Bulletproof React](https://github.com/alan2207/bulletproof-react): כל אזור עסקי מחזיק בתיקייה אחת את הקומפוננטות, ה-hooks, הטיפוסים, הקריאות לשרת והבדיקות שלו. Bulletproof הוא ריפו לדוגמה ולא תקן, ולכן אימצנו ממנו את העיקרון והתאמנו את הפרטים לכללי הקוד שלנו (אין `@/` aliases, יש סיומת בייבוא, אין קובצי index).

### מבנה היעד

```text
web/
  index.html                 the single page; the shell mounts here
  src/
    main.tsx                 entry: auth callback, then createRoot
    app-shell/               composition only: router, providers, layout, error boundary
      router.tsx
      routes.ts              route table with lazy() imports
      layout.tsx
      error-boundary.tsx
    features/                one folder per business area
      catalog/               search, filters, result list
      supplier/              supplier details, add and edit
      auth/                  login, session states, access notice
      thresholds/            monthly threshold proposals and approval
      identifiers/           identifier candidates and manual approval
      users/                 profiles, roles, unit grants
      categories/            category requests
      route-check/           engagement route wizard
      imports/               manual upload of source files (stage 4)
    ui/                      shared building blocks without business logic
    data/                    Supabase access, catalog snapshot, generated types
    lib/                     pure helpers: normalize, dates, money, urls
    styles/                  tokens.css, base.css, layers.css
  tests/                     tests of the shell and of cross-feature flows
```

### מבנה של פיצ'ר

```text
features/thresholds/
  thresholds-page.tsx        route component, one per route
  components/                components used only inside this feature
    proposal-card.tsx
    proposal-card.module.css
  hooks/
    use-proposals.ts
  api/
    proposals.ts             RPC calls and their Zod schemas
  model/
    proposal-status.ts       pure logic, no React and no network
  tests/
    proposal-status-test.ts  node --test
    proposal-card-test.tsx   Vitest + Testing Library
```

תיקייה שאין בה קבצים לא נוצרת. פיצ'ר קטן יכול להיות שלושה קבצים.

### כללי תלות

הכיוון תמיד אחד: `lib`, `ui`, `data` ← `features` ← `app-shell`.

| מי מייבא | מותר לייבא מ- | אסור |
| --- | --- | --- |
| `app-shell/` | הכול | |
| `features/<x>/` | `ui/`, `data/`, `lib/`, `styles/`, ומתוך `features/<x>/` עצמו | פיצ'ר אחר. אם שני פיצ'רים צריכים אותו דבר, הוא עובר ל-`ui/`, `data/` או `lib/` |
| `ui/` | `lib/`, `styles/` | `features/`, `data/`. רכיב UI לא יודע מה זה ספק |
| `data/` | `lib/` | React, `features/`, `ui/`. שכבת הנתונים היא TypeScript רגיל |
| `lib/` | כלום חוץ מ-`lib/` | React, רשת, DOM |

הכללים נאכפים ב-ESLint (`import-x/no-restricted-paths`). מעבר בין פיצ'רים נעשה דרך ניתוב (קישור ל-`/supplier/:id`) ולא דרך ייבוא. כך אפשר למחוק פיצ'ר שלם בלי לגעת באחרים.

### שמות וקבצים

- קבצים ב-`kebab-case`: `proposal-card.tsx`, `use-proposals.ts`. קומפוננטה ב-`PascalCase` (`ProposalCard`), hook מתחיל ב-`use`.
- `.tsx` רק לקובץ שיש בו JSX. כל לוגיקה שאפשר להוציא מהקומפוננטה יוצאת לקובץ `.ts` ב-`model/` או ב-`lib/`, כי כך היא רצה ב-`node --test` ובשרת בלי React.
- אין קובצי `index.ts` שמייצאים מחדש (barrel). הם מאטים את Vite, פוגעים ב-tree shaking ומסתירים תלויות מעגליות. מייבאים ישירות מהקובץ, עם סיומת: `import { ProposalCard } from './components/proposal-card.tsx'`.
- קומפוננטה אחת מיוצאת לכל קובץ. קומפוננטות עזר קטנות באותו קובץ מותרות אם הן לא מיוצאות.

## 2. הסטאק

| תחום | בחירה | למה | מה לא |
| --- | --- | --- | --- |
| ספרייה | React 19 + `react-dom` | הוחלט בהחלטה 0001. Actions, `useActionState`, `useOptimistic` ו-`use` חוסכים ספריות טפסים ונתונים | |
| קומפיילר | React Compiler דרך `@vitejs/plugin-react` | מוסיף memoization אוטומטית, ולכן לא כותבים `useMemo`/`useCallback`/`memo` ידנית | |
| בנייה | Vite (קיים) | כבר בשימוש, כולל ה-CSP בזמן בנייה | |
| ניתוב | React Router 8 במצב ספרייה, `createHashRouter`, ומסכים ב-`lazy` | GitHub Pages לא מחזיר `index.html` לכתובת עמוקה. Hash עובד בלי טריק 404 | Next.js, Remix, TanStack Router |
| נתונים | `data/` שלנו: snapshot של הקטלוג (אפיון #44), פונקציות RPC מוקלדות, ו-`data/screen-data.ts` לנתוני מסך לפי מפתח ([אפיון ניהול state](state-management-spec-he.md)) | בקשה אחת לקטלוג, מטמון IndexedDB לפי גרסה. ספריית מטמון כללית הייתה מכפילה את המטמון ועוברת את תקציב הקוד הראשוני. מתי כן עוברים ל-TanStack Query: סעיף 6 באפיון | TanStack Query (לעת עתה), Redux, Zustand, SWR |
| מצב | `useState`, `useReducer`, `useSyncExternalStore` למאגרים של `data/` ו-`lib/`, Context רק לנתונים שכמעט לא משתנים (משתמש, הרשאות). טיוטות טפסים ב-`lib/form-draft.ts` ו-`lib/use-form-draft.ts`, ללשונית בלבד | מספיק לגודל המערכת | ספריית state גלובלית, `localStorage` לטיוטות |
| טפסים | `<form action>` של React 19 עם `useActionState`, ואימות ב-Zod | אותה סכמה כמו ב-Edge Function | React Hook Form, Formik |
| אימות קלט | Zod 4 | הוחלט בהחלטה 0001. משותף עם `supabase/functions/_shared` | |
| עיצוב | CSS רגיל: משתנים ב-`styles/tokens.css`, `@layer`, nesting מובנה, CSS Modules (`*.module.css`) לרכיבים | אפס תלויות, עברית וימין לשמאל עובדים הכי טוב עם HTML ו-CSS רגילים | Tailwind, CSS-in-JS, ספריית רכיבים |
| בדיקות | `node --test` לקובצי `.ts`, Vitest + Testing Library + jsdom לקובצי `.tsx`, Playwright לקצה לקצה | Node לא מריץ JSX ישירות, ולכן קומפוננטות נבדקות ב-Vitest שכבר יושב על Vite | Jest, Enzyme |
| Lint | ESLint קיים + `eslint-plugin-react-hooks` (כולל כללי הקומפיילר), `eslint-plugin-jsx-a11y-x` (הגרסה המתוחזקת של `jsx-a11y`, שתומכת ב-ESLint 10), `eslint-plugin-import-x` | אוכפים את כללי ה-hooks, הנגישות והתלויות | |

כל תלות ננעלת לגרסה מדויקת ב-`package.json`. תלות חדשה שאינה בטבלה דורשת החלטה ב-`documentation/decisions/`.

לקוח Supabase: נשאר הלקוח הקטן שכתוב ביד ב-`web/src/data/`, ולא `supabase-js` שנכתב בהחלטה 0001. במדידה במשימה R1, `supabase-js` 2.119 שוקל כ-56KB gzip, ו-React עם הנתב כבר שוקלים כ-98KB. יחד זה מעבר לתקציב של 150KB בסעיף 6, לפני שורת קוד אחת של מסך. הלקוח הקיים שוקל כ-2KB. אם יידרש משהו ש-`supabase-js` נותן ואין לנו (למשל Realtime), חוזרים להחלטה.

## 3. כתיבת קומפוננטות

- **קומפוננטה עושה דבר אחד.** מעל 150 שורות או יותר מ-3 רמות JSX מקוננות, מפצלים. כללי הגודל (50 שורות לפונקציה, מורכבות 10) חלים גם על קומפוננטות.
- **Props.** טיפוס `Props` מפורש לכל קומפוננטה. עד 3 props שאינם `children` בלי אובייקט, מעבר לזה מקבצים לפי משמעות. אין `React.FC`.
- **מצב.** שומרים את המינימום. מה שאפשר לחשב מה-props או מהמצב מחושב בזמן הציור, ולא נשמר ב-`useState` ומסונכרן ב-`useEffect`.
- **`useEffect` הוא חריג.** מותר רק לסנכרון עם מערכת חיצונית (DOM, מאזין, טיימר). לא לטעינת נתונים בקומפוננטה, לא לחישוב, ולא לתגובה לאירוע של המשתמש. טעינת נתונים נעשית ב-loader של הניתוב או במאגר של `data/`.
- **מפתחות.** `key` הוא מזהה יציב מהמסד (`supplier.id`), לעולם לא אינדקס של מערך.
- **אירועים.** הטיפול באירוע כתוב בתוך ה-handler, לא ב-effect שמגיב לשינוי מצב.
- **HTML מובנה קודם.** `<dialog>` עם `showModal()` ו-`commandfor`/`command`, `<details>`, `popover`, `<search>`, `<form>`, `<fieldset>`. לא בונים מחדש בקוד מה שהדפדפן כבר נותן.
- **טקסט למשתמש** בעברית, בקבועים ליד הקומפוננטה או בקובץ `messages.ts` של הפיצ'ר. אין מחרוזות באנגלית במסך.
- **אין `dangerouslySetInnerHTML`.** אף פעם. React מוגן מפני XSS רק כשלא עוקפים אותו.

## 4. נתונים ומצב

- **כל גישה לשרת עוברת דרך `data/`** או דרך `features/<x>/api/`. קומפוננטה לא קוראת ל-`fetch` ישירות.
- **קלט מהשרת הוא `unknown`** ועובר סכמת Zod לפני שימוש. הטיפוסים של שורות המסד מגיעים מ-`database.types.ts` שנוצר אוטומטית.
- **הקטלוג נטען פעם אחת** דרך `catalog_snapshot` (אפיון [טעינת המידע](data-loading-spec-he.md)), נשמר במאגר אחד ב-`data/`, ומסכים קוראים ממנו ב-`useSyncExternalStore`. מסך לא מעתיק את הקטלוג ל-state משלו.
- **פעולה שמשנה כמה טבלאות היא RPC אחת** בצד המסד (כלל 5 בכללי הקוד). הלקוח לא מרכיב טרנזקציה מכמה קריאות.
- **אחרי כתיבה מוצלחת** מבקשים snapshot עם הגרסה הנוכחית, ולא טוענים את כל הקטלוג מחדש.
- **נתוני מסך שאינם הקטלוג** נטענים ב-loader דרך `getScreenData(key, fetcher)`, והמסך מציג אותם ב-`useScreenData`. פונקציית הכתיבה ב-`api/` היא המקום היחיד שקורא ל-`invalidate(key)`, ולא הרכיב. כך רק מה שהשתנה נטען שוב, גם בלשוניות אחרות, ובלי להריץ את כל ה-loader ולאפס את המסך.
- **טופס עם כמה שלבים** מחזיק את הערכים ואת מזהה מה שכבר נשמר ברכיב שמעל השלבים, לא בתוך שלב.
- **טופס ארוך** שומר טיוטה ללשונית (`useFormDraft`) ומוחק אותה אחרי שמירה מוצלחת.
- **עדכון אופטימי** (`useOptimistic`) רק לפעולה שהשרת כמעט תמיד מאשר ושקל לבטל. לאישורים רגישים (סף חודשי, מזהה ספק) מחכים לתשובת השרת.
- **הרשאות בממשק הן נוחות בלבד.** הסתרת כפתור לא מגינה על כלום. כל פעולה נבדקת ב-RLS או בפונקציה במסד, והממשק מציג את השגיאה שחזרה.

## 5. ניתוב וטעינה

- `main.tsx` מטפל קודם בחזרה מההתחברות (קוד PKCE או טוקן ב-fragment), מנקה את הכתובת, ורק אז יוצר את הנתב. אחרת `#access_token=...` ייקרא כנתיב.
- כל מסך נטען ב-`lazy()`, כך שמי שנכנס לקטלוג לא מוריד את קוד מסכי הניהול.
- כל נתיב מגדיר `errorElement`. שגיאה במסך אחד לא מפילה את כל האתר.
- נתיב שדורש תפקיד בודק אותו ב-loader ומציג הודעה ברורה. הבדיקה האמיתית נשארת במסד.
- כותרת הדף (`<title>`) מתעדכנת בכל מסך, והפוקוס עובר לכותרת `h1` של המסך החדש, כדי שקורא מסך יודיע על המעבר.

## 6. ביצועים

התקציב נבדק ב-CI על פלט הבנייה. חריגה מכשילה את הבדיקה.

| מדד | תקציב |
| --- | --- |
| JavaScript בטעינה הראשונה (gzip) | עד 150KB, כולל React |
| כל מסך שנטען ב-`lazy` (gzip) | עד 40KB |
| בקשות רשת עד שהקטלוג מוצג | 2 (לפי אפיון #44) |
| תשובת הקטלוג | עד 300KB |
| LCP בנייד, כניסה חוזרת | עד 1.5 שניות |
| INP בהקלדה בחיפוש | עד 200ms |
| CLS | עד 0.1 |

הכללים, לפי המדריכים `performance`, `break-up-long-tasks` ו-`defer-rendering-heavy-content` של modern-web-guidance:

- **סקריפט אחד מסוג `module`** ב-`<head>`. מודול נדחה כברירת מחדל ואינו חוסם את הפענוח.
- **`preconnect` לכתובת Supabase** בזמן בנייה, כדי שהחיבור יהיה מוכן כשהבקשה יוצאת.
- **בקשת הקטלוג יוצאת מיד** בטעינת `data/`, במקביל לטעינת React, ולא אחרי שהקומפוננטה עלתה.
- **חיפוש לא חוסם הקלדה.** שדה החיפוש מתעדכן מיד, והתוצאות דרך `useDeferredValue`. טקסט החיפוש המנורמל מחושב פעם אחת בבניית המודל.
- **רשימה ארוכה מצוירת בחלקים.** משימה מעל 50ms מתפצלת עם `scheduler.yield()`, ו-`setTimeout` עטוף ב-Promise כגיבוי. ציור חדש מבטל ציור קודם.
- **כרטיסים מתחת לקו הגלילה** מקבלים `content-visibility: auto` יחד עם `contain-intrinsic-size: auto <גובה משוער>`. בלי `contain-intrinsic-size` פס הגלילה קופץ. לא מחילים את זה על התוכן שבמסך הראשון, ובודקים שאפשר להגיע לכל כרטיס במקלדת.
- **אין קריאה וכתיבה של layout באותה לולאה** (`getBoundingClientRect` ואחריו שינוי סגנון).
- **אין `useMemo`/`memo` ידני.** הקומפיילר עושה את זה. אם פרופיילר מראה בעיה, מתעדים אותה בהערה ליד התיקון.
- **מדידה.** `performance.mark`/`measure` לזמן הבקשה, בניית המודל והציור הראשון, ו-LCP/INP/CLS מ-`PerformanceObserver`, נשלחים דרך ה-tracker הקיים בלי פרטים מזהים.

## 7. עברית, ימין לשמאל ונגישות

- `<html lang="he" dir="rtl">`. כל ריווח ומיקום במאפיינים לוגיים: `margin-inline-start`, `padding-block`, `inset-inline-end`. אין `left`/`right` ב-CSS חדש.
- מספרים, מזהים, תאריכים וכתובות דוא"ל בתוך טקסט עברי עטופים ב-`<bdi>` או מקבלים `dir="ltr"`, כדי שלא יתהפכו.
- תאריך מוצג ב-`Intl.DateTimeFormat('he-IL')` וסכום ב-`Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })`. בקוד ובמסד התאריך נשאר `YYYY-MM-DD`.
- מבנה הדף: `header`, `nav`, `main` אחד, `footer`. כותרת `h1` אחת לכל מסך, בלי לדלג על רמות. קישור "דילוג לתוכן" לפני הכותרת.
- כל שדה עם `<label>` גלוי. הודעת עזר ושגיאה מחוברות ב-`aria-describedby`. שגיאה מוצגת רק אחרי שהמשתמש נגע בשדה (`:user-invalid`), וה-`aria-invalid` מסונכרן איתה. בשליחה שנכשלה, הפוקוס עובר לשדה הראשון השגוי. לא משביתים את כפתור השליחה כדי לחסום אימות, רק אחרי שליחה תקינה כדי למנוע כפילות.
- תוצאת פעולה אסינכרונית מוכרזת ב-`role="status"`. שגיאה חוסמת ב-`role="alert"`.
- יעד לחיצה לפחות 48px. גופנים ב-`rem`, וגודל שדה טופס לפחות `1rem` כדי שהנייד לא יגדיל את הדף.
- פוקוס תמיד נראה (`:focus-visible`). אין `outline: none` בלי חלופה.
- אנימציה רק בתוך `@media (prefers-reduced-motion: no-preference)`.
- מידע לא מועבר רק בצבע: סטטוס "פג תוקף" מקבל גם טקסט.

## 8. CSS

- **אסימונים.** צבעים, ריווחים, גופנים ורדיוסים כמשתני CSS ב-`styles/tokens.css`. אין ערך צבע או ריווח קבוע בקובץ רכיב.
- **שכבות.** `@layer reset, base, ui, features, utilities;` בראש `styles/layers.css`. כך הסדר קבוע ואין מלחמות specificity.
- **CSS Modules** לרכיבים: `proposal-card.module.css` ליד `proposal-card.tsx`. מחלקות גלובליות רק ב-`styles/`.
- **פריסה רספונסיבית לפי מכל.** רכיב שמשנה פריסה לפי הרוחב שלו משתמש ב-container queries, לא ב-media query של המסך.
- **בלי `@import` ב-CSS.** הוא יוצר שרשרת בקשות. Vite מאחד את הקבצים.

## 9. אבטחה

- רק המפתח ה-publishable בדפדפן. כל משתנה `VITE_*` נכנס לקוד הציבורי, ולכן אין בו סוד.
- ה-CSP נשאר כפי שהוא נבנה ב-`web/src/csp.ts`: בלי `unsafe-inline` לסקריפטים, ו-`connect-src` רק לכתובת Supabase.
- קישור חיצוני מתקבל רק אם הוא `https:` (בדיקה ב-`lib/urls.ts`) ונפתח עם `rel="noopener noreferrer"`.
- אין תוכן טפסים, פרטי קשר או מזהים ביומן האירועים ובהודעות שגיאה שנשלחות.
- טוקן ההתחברות לא נשמר ב-`localStorage` מעבר למה שהלקוח צריך, ונמחק ביציאה יחד עם מטמון הקטלוג.

## 10. טעינה, שגיאות ומצבים ריקים

- לכל מסך שטוען נתונים יש ארבעה מצבים מוגדרים: טוען, ריק, שגיאה ותוכן. אין מסך שנשאר על "טוען" לנצח: לכל בקשה יש מגבלת זמן (`REQUEST_TIMEOUT_MS`).
- `ErrorBoundary` אחד ב-`app-shell/` ו-`errorElement` לכל נתיב. השגיאה מוצגת בעברית עם כפתור "נסו שוב", ונשלחת ל-tracker בלי פרטים מזהים.
- שגיאות 401 ו-403 מקבלות הודעה משלהן (פג תוקף, אין הרשאה), כמו ב-`DataError` הקיים.
- שלד טעינה (skeleton) באותו גובה של התוכן, כדי שלא תהיה קפיצה (CLS).

## 11. בדיקות

| סוג | כלי | מה נבדק | מיקום |
| --- | --- | --- | --- |
| יחידה | `node --test` | כל קובץ ב-`lib/`, `model/`, `data/`, `api/` | `features/<x>/tests/*-test.ts`, `web/tests/` |
| קומפוננטה | Vitest + Testing Library | התנהגות מנקודת המבט של המשתמש: מה רואים, מה קורה בלחיצה. שאילתות לפי role ו-label, לא לפי מחלקות | `features/<x>/tests/*-test.tsx` |
| נגישות | `eslint-plugin-jsx-a11y-x`, ובדיקת axe בבדיקות הקצה | תוויות, תפקידים, ניגודיות | |
| קצה לקצה | Playwright מול Supabase מקומי | התחברות, חיפוש, פתיחת ספק, שמירה, אישור סף. לכל תפקיד פעם אחת | `web/e2e/` |
| הרשאות | PGlite (קיים) | כל מדיניות RLS לכל תפקיד | `supabase/tests/` |

באג שתוקן מקבל קודם בדיקה שנכשלת. בדיקה לא ניגשת לרשת אמיתית ולא תלויה בשעון: `fetch` ותאריך "היום" מוזרקים.

## 12. כלים ו-CI

- `npm run check` מריץ עיצוב, lint, טיפוסים, יצירת טיפוסי מסד, כל הבדיקות (כולל Vitest), בנייה ובדיקת תקציב הגודל.
- `tsconfig` של `web/` מוסיף `"jsx": "react-jsx"` ו-`"lib": ["es2023", "dom", "dom.iterable"]`. כל שאר ההגדרות הקפדניות נשארות.
- Prettier מעצב גם `.tsx` ו-`.css`.
- פלט הבנייה לא נשמר בריפו. הפריסה רק דרך `deploy-web.yml`.

## 13. צ'ק-ליסט

### לפני כל בקשת מיזוג

- [ ] הקבצים בתוך התחום שהוגדר למשימה בתוכנית העבודה, ואין שינוי בקובץ של משימה אחרת.
- [ ] אין ייבוא בין פיצ'רים, אין קובצי index, כל ייבוא עם סיומת.
- [ ] `npm run check` עובר מקומית.
- [ ] לכל מסך יש מצבי טעינה, ריק ושגיאה.
- [ ] כל שדה עם תווית, הודעת שגיאה מחוברת, ופוקוס לשדה השגוי בשליחה.
- [ ] בדיקה במקלדת בלבד: אפשר להגיע לכל פעולה ולסגור כל חלון ב-Esc.
- [ ] בדיקה בנייד (רוחב 360px) ובעברית: אין גלילה אופקית, מספרים לא מתהפכים.
- [ ] אין `useEffect` לטעינת נתונים או לחישוב, אין `useMemo` ידני בלי הסבר.
- [ ] אין `dangerouslySetInnerHTML`, אין סוד ב-`VITE_*`.
- [ ] גודל החבילה בתוך התקציב (הבדיקה ב-CI מדפיסה אותו).
- [ ] נבדקו המדריכים הרלוונטיים ב-modern-web-guidance, וצוינו בתיאור.

### לפני עלייה לייצור

- [ ] הבנייה נפרסה קודם לסביבת הבדיקה (`staging`) ונבדקה מול נתוני דמה.
- [ ] בדיקות הקצה עברו מול Supabase מקומי לכל תפקיד.
- [ ] Security Advisor ו-Performance Advisor של Supabase נקיים או שהאזהרות מתועדות.
- [ ] נמדדו LCP, INP ו-CLS בנייד ועומדים בתקציב.
- [ ] ה-CSP בפלט הבנייה כולל רק את כתובת Supabase של הסביבה.
- [ ] יציאה מוחקת טוקן ומטמון. משתמש חסום לא רואה נתונים גם מהמטמון.
- [ ] בעל המוצר אישר את הפריסה בלחיצה ב-Actions.

## מקורות

- [Bulletproof React: Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [React Compiler](https://react.dev/learn/react-compiler)
- [React 19: Actions and useActionState](https://react.dev/reference/react/useActionState)
- [React Router: createHashRouter](https://reactrouter.com/api/data-routers/createHashRouter)
- [Vitest](https://vitest.dev/), [Testing Library: Guiding Principles](https://testing-library.com/docs/guiding-principles)
- modern-web-guidance: `performance`, `defer-rendering-heavy-content`, `break-up-long-tasks`, `forms`, `accessibility`, `css`
