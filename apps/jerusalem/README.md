# מאגרי יועצים – עיריית ירושלים

כלי פנימי לאיתור ספקים מתוך פרסומי מאגרי היועצים של העירייה, ולבדיקת מסלול ההתקשרות לפי תקנות העיריות (מכרזים). המערכת בפיתוח. הנתונים חולצו אוטומטית וטרם אומתו במלואם, והכלי אינו מאשר התקשרות.

**מתחילים כאן:** [מפת המוצר](documentation/product-map-he.md): מי משתמש, אילו מסכים יש, מה עוד לא קיים, ואיזה מסמך אפיון עדיין קובע.

סדר העבודה עכשיו: [סקירת היישור מ-25.11](documentation/alignment-review-2026-11-25-he.md). המבנה: [תוכנית הארכיטקטורה](documentation/architecture-plan-he.md). החלטות: [`documentation/decisions/`](documentation/decisions/).

## מה יש בריפו
| חלק | מיקום | מצב |
|---|---|---|
| האתר | `web/` | אתר React ב-TypeScript מול Supabase, בעיצוב לפי [DESIGN.md](DESIGN.md): דף בית, איתור ספקים ומתקנים, דף ספק עם "מותר / לא מותר / לבדוק", בקשות התקשרות ופניות, האזור האישי לספקים ומסכי ניהול. רשימת המסכים: [מפת המוצר](documentation/product-map-he.md). נבנה ונפרס ב-GitHub Actions |
| בסיס הנתונים | `supabase/migrations/` | כל הסכמה, ההרשאות וה-RLS כמיגרציות. נבדקות ב-`supabase/tests/` |
| נתוני דמה | `supabase/seed/dummy.sql` | לסביבה המקומית ולסביבת הבדיקה בלבד |
| פונקציות שרת | `supabase/functions/` | בדיקת מסלול (`route-check`, ראו `documentation/procurement-engine-he.md`), עדכון ספים חודשי (`threshold-index`), חיפוש מזהי ספקים (`supplier-identifiers`), בדיקת עריכת ספק (`supplier-change-check`), בדיקה חודשית ברשם (`registry-recheck`) ובדיקת כתובות (`address-check`). מה פרוס: `supabase/functions/deployed.txt` |
| בדיקות דפדפן | `e2e/` | Playwright מול Supabase מקומי: המסלולים העיקריים, ובדיקת עשן אחרי כל פריסה. ראו [בדיקות דפדפן](documentation/e2e-tests-he.md) |
| נתוני הקובץ המאוחד | `data/pool-file/` | קובצי JSON של המאגרים, פרטי הקשר והאולמות שנטענו מהקובץ המאוחד. ראו [טעינת מאגרים](documentation/pool-file-load-he.md) |
| סקריפטי חילוץ | `scripts/` | Python. חילוץ טבלאות מקובצי PDF ו-Excel של העירייה לקובץ לבדיקה |
| תהליכי CI ופריסה | `.github/workflows/` | בדיקות בכל PR, פריסת אתר, פריסת Supabase, טעינת הקובץ המאוחד והפעלת עדכון הספים. ראו [סביבות ופריסה](documentation/environments-he.md) |

## מצב הנתונים במסד החי (25.11.2026)
49 מאגרים, 1,276 ספקים פעילים ו-2,798 שיוכים. ל-473 ספקים יש מספר מזהה מאושר, וחסר ל-803; 377 מועמדים
למזהה ו-297 הצעות לסוג ישות מחכים לאישור. 23 מאגרים עדיין בלי יחידה אחראית. אף שיוך עוד לא נבדק מול
מסמך המאגר, ולכן רוב הספקים מוצגים "לבדוק" עד שלב האימות לפי מאגר. המספרים העדכניים מופיעים בדף הבית
של האתר.

## הרצה ובדיקות
- נדרש Node 22.18 ומעלה ו-Python 3.12.
- `npm ci --ignore-scripts`, ואז `npm run check`: עיצוב, lint, בדיקת טיפוסים, ובדיקות TypeScript, ממשק ו-RLS. חובה לפני דחיפה.
- אתר: `npm run dev:web`. בלי `.env` האתר פונה לפרויקט החי. למסד מקומי או לסביבת הבדיקה, ראו `.env.example`.
- מסד מקומי (דורש Docker): `npx supabase@3.1.0 start` מחיל את המיגרציות ואת נתוני הדמה. `npx supabase@3.1.0 db reset` מתחיל מחדש.
- בדיקות דפדפן: `npm run e2e` מול המסד המקומי. ההגדרה: [בדיקות דפדפן](documentation/e2e-tests-he.md).
- טיפוסי הטבלאות ב-`web/src/database.types.ts` נוצרים מהמיגרציות עם `npm run types:db`, ו-`npm run types:db:check` מזהה אי-התאמה.
- Python: `ruff format --check . && ruff check .` ו-`python3 -m unittest discover -s tests -t .`
- סקריפטי חילוץ: `pip install -r requirements-scripts.txt`, ואז `python3 scripts/extract.py --sources <תיקייה> --output <קובץ.json>` או `python3 scripts/extract_additional.py --sources <תיקייה> --output <קובץ.csv>`.

## פריסה
שינוי מגיע לסביבה החיה רק דרך GitHub Actions. מיגרציות מוחלות קודם על סביבת הבדיקה, ועל החי רק בהפעלה ידנית ואחרי אישור בלחיצה. האתר, לעומת זאת, מתפרסם מיד עם המיזוג ל-`main`, ולכן מיגרציה שהאתר תלוי בה מוחלת על החי לפני המיזוג. הפרטים וההגדרה החד פעמית: [סביבות ופריסה](documentation/environments-he.md).

## כללי קוד
כל קוד חדש נכתב לפי [כללי הקוד](documentation/coding-standards-he.md). רוב הכללים נאכפים ב-CI.

## עקרונות
קובצי המקור אינם חלק מהריפו. תאריך פרסום אינו תוקף מאגר או חוזה. לכל רשומה נשמר מקור, וכל רשומה עוברת בדיקה אנושית לפני הסתמכות. ההרשאות נאכפות בבסיס הנתונים ולא בדפדפן.
