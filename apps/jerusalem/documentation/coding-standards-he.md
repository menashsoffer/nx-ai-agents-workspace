# כללי קוד

המסמך מחייב כל קוד חדש בריפו, שנכתב בידי אדם או בידי סוכן AI. כלל שאפשר לאכוף אוטומטית נאכף ב-CI, וההגדרות נמצאות בקבצים שמצוינים לצידו. קוד ישן שעדיין לא עומד בכללים מסומן ברשימת "קוד ישן" בסוף המסמך, ומתוקן כשנוגעים בו.

עודכן: 13.11.2026. המקורות מופיעים בסוף המסמך.

## 1. ארכיטקטורה ושפות

Supabase הוא מרכז המערכת: בסיס הנתונים, ההזדהות, ההרשאות והלוגיקה בצד השרת. כל השאר נבנה סביבו.

| שכבה | שפה | מיקום | הערות |
|---|---|---|---|
| סכמה, הרשאות, RLS, פונקציות DB | SQL (PostgreSQL) | `supabase/migrations/` | המקור היחיד לסכמה. אין שינוי ידני בלוח הבקרה |
| לוגיקה עסקית (מנוע הכללים) | TypeScript | `supabase/functions/_shared/` | קוד טהור, בלי תלויות ובלי גישה לרשת. רץ ב-Deno וב-Node |
| נקודות קצה בשרת | TypeScript (Deno) | `supabase/functions/<שם-בקו-מפריד>/index.ts` | Edge Functions דקות שקוראות ללוגיקה מ-`_shared` |
| האתר | TypeScript, React | `web/` (מקור). הפלט נבנה ב-Actions ואינו נשמר בריפו | ראו החלטות 0001, 0003 ו-0006, ו-`react-guide-he.md` |
| חילוץ נתונים ו-OCR מ-PDF ו-Excel | Python 3.12 | `scripts/` (יעבור ל-`pipeline/`) | עבודת אצווה, מקומית או ב-GitHub Actions. כותבת לטבלאות הביניים בלבד. ראו החלטות 0004 ו-0005 |
| בדיקות | כמו הקוד הנבדק | `supabase/functions/tests/<נושא>-test.ts` ל-TypeScript (המוסכמה של Supabase), `tests/` ל-Python ול-RLS | ראו סעיף 6 |
| תיעוד | Markdown בעברית | `documentation/`, `README.md` | |

אין שפות או מסגרות נוספות בלי החלטה מתועדת ב-`documentation/decisions/`. ההחלטות שהתקבלו עד כה נמצאות שם, והרקע להן ב-`documentation/architecture-plan-he.md`. Python לא ישמש לקוד שרץ מול משתמש. אין שרת נוסף מחוץ ל-Supabase ול-GitHub Pages. עבודות אצווה כבדות רצות ב-GitHub Actions.

## 2. גודל וצורה

| כלל | גבול | נאכף ב- |
|---|---|---|
| אורך שורה | 100 תווים. מחרוזות טקסט ארוכות (למשל הודעות בעברית) פטורות כדי לא לשבור אותן | Prettier, ESLint `max-len`, Ruff |
| אורך קובץ קוד | 300 שורות (בלי שורות ריקות והערות) | ESLint `max-lines` |
| אורך קובץ בדיקות | 500 שורות | ESLint |
| אורך פונקציה | 50 שורות | ESLint `max-lines-per-function` |
| מורכבות ציקלומטית | 10 | ESLint `complexity`, Ruff `C901` |
| עומק קינון | 3 | ESLint `max-depth` |
| מספר פרמטרים | 3. מעבר לזה, אובייקט אחד עם שדות בשם | ESLint `max-params` |
| קובץ מיגרציה | נושא אחד. עד 400 שורות | סקירה |
| פקודה אחת בשורה | תמיד. אין שרשור של כמה פקודות עם `;` | Prettier, Ruff `E701/E702` |

קובץ שעובר את הגבול מפוצל לפי אחריות, ולא לפי מספר שורות. אין קבצים מכווצים (minified) בריפו, חוץ מפלט build שנוצר אוטומטית.

## 3. מבנה, שמות ועיצוב

- **שמות קבצים**: `kebab-case.ts` ב-TypeScript, `snake_case.py` ב-Python, `<timestamp>_<snake_case>.sql` במיגרציות (התבנית של Supabase CLI).
- **שמות בקוד**: `camelCase` למשתנים ופונקציות ב-TypeScript, `PascalCase` לטיפוסים, `UPPER_SNAKE_CASE` לקבועים ברמת מודול. ב-SQL הכול `snake_case`. ב-Python לפי PEP 8.
- **שפת הקוד**: שמות, הערות קוד והודעות commit באנגלית. טקסט שהמשתמש רואה, ותיעוד ב-`documentation/`, בעברית.
- **הערות**: מסבירות למה, לא מה. כל הנחה משפטית מפנה לתקנה או למקור, למשל `// תקנה 8(ד)(1)`.
- **מספרי קסם**: אסורים. סכומים, אחוזים ותאריכים משפטיים הם קבועים עם שם ומקור, או נתונים בטבלה.
- **עיצוב**: Prettier ל-TypeScript, JSON ו-Markdown. Ruff format ל-Python. אין ויכוחים על סגנון: מה שהכלי מפיק הוא הסגנון.
- **ייבוא**: ב-TypeScript ייבוא יחסי עם סיומת `.ts`, ו-`import type` לטיפוסים. אין `paths` ב-tsconfig, כי Node ו-Deno לא קוראים אותו.

## 4. TypeScript

- `strict: true`, וגם `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` ו-`noImplicitOverride`. ההגדרות ב-`tsconfig.json`.
- `erasableSyntaxOnly` ו-`verbatimModuleSyntax`, כדי שהקוד ירוץ ישירות ב-Node וב-Deno בלי שלב המרה. לכן אין `enum`, אין `namespace` עם קוד, ואין parameter properties. במקום `enum` משתמשים באובייקט `as const` ובטיפוס union.
- אין `any`. קלט חיצוני (בקשת HTTP, JSON, שורה מבסיס הנתונים) נכנס כ-`unknown` ועובר בדיקה לפני שימוש.
- ESLint עם `strictTypeChecked` ו-`stylisticTypeChecked` של typescript-eslint.
- לוגיקה עסקית היא פונקציות טהורות: אין גישה לרשת, לשעון או למשתנים גלובליים. תאריך "היום" מגיע כפרמטר.
- שגיאות: קלט לא תקין זורק `Error` עם הודעה ברורה. אין להחזיר תוצאה חיובית כשהקלט לא נבדק.
- תאריכים משפטיים נשמרים כמחרוזת `YYYY-MM-DD` ולא כ-`Date`, כדי לא להיות תלויים באזור זמן.
- סכומי כסף ב-₪ הם `number`, כולל אגורות. כל סכום מקלט חיצוני עובר בדיקה שהוא סופי ואינו שלילי.

## 5. Supabase ו-PostgreSQL

**מיגרציות**
- כל שינוי בסכמה, בהרשאות או בפונקציות נעשה במיגרציה חדשה. מיגרציה שכבר הוחלה לא נערכת. מתקנים אותה במיגרציה נוספת.
- הסכמה החיה (כולל `suppliers`) מיוצאת לריפו עם `supabase db pull` לפני כל שינוי בה.
- כל מיגרציה רצה בהצלחה על בסיס נתונים ריק בבדיקות ה-CI.

**הרשאות ו-RLS**
- RLS מופעל על כל טבלה בסכמה שחשופה ל-API, בלי יוצא מן הכלל. טבלה בלי מדיניות נחשבת סגורה.
- כל מדיניות מציינת `to authenticated` או `to anon` במפורש.
- ההרשאות נאכפות בבסיס הנתונים בלבד. בדיקה בדפדפן היא נוחות למשתמש ואינה הגנה.
- שדות שהשרת קובע (`created_by`, סטטוס בדיקה, זמנים) מקבלים ערך ב-default או ב-trigger. הם לא נשלחים מהלקוח, ואם נשלחים, הם נדרסים.
- פונקציות בתוך מדיניות נעטפות ב-`select`, למשל `(select auth.uid())`, כדי ש-Postgres יחשב אותן פעם אחת לשאילתה.
- עמודה שמופיעה במדיניות מקבלת אינדקס.
- בדיקת הרשאה שקוראת טבלה אחרת עוברת לפונקציית `security definer` בסכמה פרטית שאינה חשופה ל-API, עם `set search_path = ''` ושמות טבלאות מלאים.
- כל פונקציה מתחילה ב-`revoke all ... from public, anon, authenticated`, ומקבלת `grant execute` רק למי שצריך.
- הרשאות על עמודות (`grant insert (col, ...)`) לשדות רגישים, בנוסף ל-RLS.
- פעולה שמשנה כמה טבלאות יחד היא פונקציה אחת (טרנזקציה אחת), ולא כמה קריאות מהלקוח.
- Security Advisor של Supabase נבדק לפני כל מיזוג שנוגע בבסיס הנתונים. אזהרה נסגרת או מתועדת.

**מפתחות וסודות**
- בדפדפן משתמשים רק במפתח `publishable`. מפתח `secret` נמצא רק ב-Edge Functions, דרך משתני סביבה.
- אין סודות בריפו. משתני סביבה מתועדים ב-`.env.example` בלי ערכים.

**Edge Functions**
- שם בקו מפריד (`route-check`), קובץ `index.ts`, וקוד משותף ב-`_shared/`.
- עדיף מעט פונקציות גדולות מהרבה קטנות. נקודת הקצה רק מפרסרת קלט, בודקת אותו, קוראת ללוגיקה ב-`_shared` ומחזירה JSON.
- `verify_jwt` נשאר פעיל, אלא אם יש החלטה מתועדת אחרת.
- תלויות עם גרסה נעולה (`npm:pkg@x.y.z`).

## 6. בדיקות

- כל לוגיקה עסקית מכוסה בבדיקות יחידה, כולל ערכי גבול (בדיוק על הסף, אגורה מעליו) וקלט לא תקין.
- כל מדיניות RLS נבדקת לכל תפקיד: אנונימי, משתמש ממתין, משתמש פעיל, מנהל, משתמש חסום. הבדיקות רצות ב-PostgreSQL מבודד (PGlite), ומעבר ל-production דורש גם בדיקה על Supabase מבודד.
- באג שתוקן מקבל בדיקה שנכשלת בלי התיקון.
- הבדיקות לא ניגשות לרשת ולא תלויות בשעון: תאריך מוזרק.
- כלים: `node --test` ל-TypeScript (Node 22.18 ומעלה מריץ TypeScript ישירות), `unittest` ל-Python.
- לפני push: `npm run check` (עיצוב, lint, טיפוסים, בדיקות וכיסוי), וגם `ruff format --check . && ruff check .` כשנוגעים ב-Python.
- כיסוי בדיקות של 90% לפחות הוא תנאי למיזוג, ונבדק ב-CI:
  - TypeScript: `npm run coverage` מריץ את כל הבדיקות (Node ו-Vitest), מאחד את הכיסוי לדוח אחד ונכשל מתחת ל-90% בשורות, בענפים ובפונקציות. קובץ שאין לו בדיקה נספר כ-0%. היקף הקבצים והספים ב-`scripts/coverage/scope.json`. קובץ יוצא מההיקף רק אם הוא נקודת כניסה דקה (CLI), עם נימוק.
  - SQL: אותה פקודה סופרת אילו מפונקציות הסכמות `public` ו-`private` נקראו בבדיקות ה-PGlite, ונכשלת מתחת ל-90%. פונקציה שלא נקראה מופיעה בשמה בדוח.
  - Python: `python -m coverage run -m unittest discover -s tests -t . && python -m coverage report`, עם סף 90% ב-`pyproject.toml`.
- הבדיקות לא כותבות לבסיס הנתונים של production ולא לסביבת staging: בדיקות מסד הנתונים רצות רק ב-PGlite מקומי, ופונקציות ה-Edge נבדקות מול `fetch` מדומה.

## 7. אבטחה ופרטיות

- רינדור בדפדפן רק עם `textContent` או בניית אלמנטים. אסור להשתמש ב-`innerHTML` עם נתונים.
- קישור חיצוני מתקבל רק אם הוא `https:`, ונפתח עם `rel="noopener noreferrer"`.
- נאסף רק מידע שנחוץ. ביומן הפעולות אין תוכן טפסים ואין פרטי קשר.
- קובצי המקור של העירייה לא נכנסים לריפו. לכל רשומה נשמרים קישור למקור ומספר עמוד.

## 8. Git ותהליך

- עבודה בענף ו-PR. אין דחיפה ישירה ל-`main`.
- PR אחד לנושא אחד. כש-PR גדל מעבר לכ-400 שורות שינוי (בלי קבצים שנוצרו אוטומטית), מפצלים אותו.
- CI ירוק הוא תנאי למיזוג: עיצוב, lint, בדיקת טיפוסים, כל הבדיקות, והחלת המיגרציות.
- הודעת commit באנגלית, בזמן הווה, ומסבירה למה.
- ענף שמוזג נמחק.

## 9. Python (סקריפטי החילוץ בלבד)

- Python 3.12, Ruff לעיצוב ול-lint (ההגדרות ב-`pyproject.toml`).
- כל סקריפט מקבל נתיבים כפרמטרים (`--sources`, `--output`). אין נתיבים קבועים בקוד.
- פונקציות משותפות במודול משותף, עם בדיקות. אין העתקת קוד בין סקריפטים.
- הפלט הוא קובץ לבדיקה אנושית. סקריפט לא כותב ישירות לבסיס הנתונים.
- תלויות עם גרסה מינימלית ב-`requirements-scripts.txt`.

## 10. קוד ישן שעדיין לא עומד בכללים

אין כרגע קוד ישן. משימה R12 בתוכנית המעבר ל-React (17.11.2026) מחקה את הדף הישן (`web/src/app/`, קובצי `*-view.ts`, `main.ts`, `styles.css` ו-`admin.html`), והעבירה את בדיקות `tests/*.cjs` ל-TypeScript. האתר הוא דף React אחד, `web/index.html`.

קוד חדש שלא עומד בכללים לא נכנס לרשימה הזו: מתקנים אותו לפני המיזוג.

## מקורות
- [Supabase: RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: Edge Functions development tips](https://supabase.com/docs/guides/functions/development-tips)
- [Supabase: Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Security Retro 2025](https://supabase.com/blog/supabase-security-2025-retro)
- [Node.js: Modules: TypeScript](https://nodejs.org/api/typescript.html)
- [typescript-eslint: Linting with Type Information](https://typescript-eslint.io/getting-started/typed-linting)
- [PEP 8](https://peps.python.org/pep-0008/), [Ruff](https://docs.astral.sh/ruff/)
