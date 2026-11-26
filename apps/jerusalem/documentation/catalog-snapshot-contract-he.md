# חוזה טעינת הקטלוג

המימוש נשען על אפיון טעינת המידע ב־#44. שתי הפונקציות הציבוריות פועלות כ־`security invoker`; כל קריאה לטבלה עוברת RLS. רק משתמש מזוהה יכול להריץ אותן.

`catalog_snapshot(known_version text default null)` מחזירה `user_id`, `access` ו־`version`. ב־`access` נמצאים `state`, `member`, `admin`, `editor`, `manager` ו־`grants` (כל מענק כולל `role` ו־`unitId`). משתמש שאינו חבר פעיל אינו מקבל קטלוג. חבר עם גרסה עדכנית מקבל `unchanged: true`. אחרת מוחזר `catalog`.

לצמצום התשובה, שורות הקטלוג הן מערכים עם סדר עמודות קבוע. אין חזרה על `supplier_id` בשורות המקוננות. אין ביומן המקומי נתוני ביקורת. שינוי חוזה מחייב גם שינוי גרסת מפתח המטמון בדפדפן (היום `consultants-catalog-v2`).

| מפתח | סדר העמודות |
|---|---|
| `suppliers` | `id, display_name, entity_kind, status, website, review_status, note, names, memberships, contactKinds, identifierState, inactive, venue` |
| `names` בתוך ספק | `name, kind, documentAt` |
| `memberships` בתוך ספק | `versionAt, fieldAt, name_as_published, source_page, registered_from, registered_until, engagement_started_on, dates_source, review_status` |
| `contactKinds` בתוך ספק | סוגי פרטי הקשר הנוכחיים, ממוינים וללא כפילות, למשל `["email", "phone"]` |
| `registries` | `id, name, owner_unit_id, status` |
| `versions` | `id, registryAt, documentAt, valid_from, valid_until` |
| `fields` | `id, registryAt, source_text` |
| `categories` | `id, name, parent_id` (כולן פעילות) |
| `fieldCategories` | `registry_field_id, category_id` |
| `units` | `id, name` |
| `documents` | `id, url` |

עמודה שמסתיימת ב־`At` היא מיקום (מ־0) במערך המקביל בתשובה: `versionAt` ב־`versions`, `fieldAt` ב־`fields`, `registryAt` ב־`registries` ו־`documentAt` ב־`documents`. שני הצדדים נקראים באותה הרשאה וממוינים לפי מזהה, ולכן המיקומים תואמים. `null` פירושו שאין קישור או שהשורה המקושרת אינה גלויה למשתמש. שיוך לגרסה שאינה גלויה אינו נשלח. מיקום שחורג מהמערך הוא שגיאה בצד הדפדפן.

`identifierState` הוא `verified` כשיש מזהה מאושר, `pending` כשיש מזהה או מועמד שממתינים לאישור, ו־`null` כשאין. הוא נגזר רק ממה שהמשתמש רשאי לראות, ולכן צופה לא רואה מועמדים. `inactive` הוא `[reason, source, changedOn]` לספק לא פעיל ו־`null` לאחרים (מיגרציה `20261117050000`). שינוי במזהים או במועמדים מגדיל את מונה הגרסה.

`venue` הוא `[capacity, capacity_text, hall_size, stage_size, screen, sound, lighting, survey_year]` לספק שהוא אולם או מתקן, ו־`null` לאחרים (מיגרציה `20261117070000`, טבלה `venue_specs`). שינוי בטבלה מגדיל את מונה הגרסה.

ערכי פרטי הקשר אינם בקטלוג (מיגרציה `20261117040000`). הם מגיעים מ־`supplier_detail` כשפותחים ספק. כך הקטלוג קטן יותר, ופרטי קשר נקראים רק בעת הצורך. במדידה במסד החי ב־17.11, עם 1,299 ספקים, התשובה ירדה מכ־1.14MB לכ־482KB לפני דחיסה.

מזהי הספקים, המאגרים, הקטגוריות והיחידות נשארים UUID מקוריים; מזהי רשומות שם ושיוך אינם נשלחים משום שהאתר אינו משתמש בהם. ערך `0` בעמודת שם מקונן פירושו שם הספק המוצג, ו־`null` בשם שפורסם נשאר שם חסר. ערך `null` בעמודות הלא־ריקות הבאות מייצג את ברירת המחדל: `entity_kind=unknown`, `status=active`, `review_status=needs_review`, `kind=as_published`, `dates_source=unknown`. כך ערכי ברירת מחדל ושמות זהים אינם משוכפלים. אין שינוי במידע המפוענח.

 כל שיוך מפנה לגרסה ולתחום לפי מזהה. הקטלוג אינו כולל ספקים ממוזגים, פרטי קשר שאינם נוכחיים או שיוכים שהוסרו או נדחו. שורות העזר מוחזרות פעם אחת, גם אם מספר ספקים משתמשים בהן.

הגרסה כוללת מונה משותף וטביעת מזהה המשתמש, מצבו והרשאותיו הפעילות. טריגר פקודה מגדיל את המונה בכל כתיבה לטבלה מהקטלוג. הטריגר פועל בהרשאות הכותב; הרשאת העדכון למונה מוגבלת בסכמה הפרטית לעדכון מתוך טריגר. אין הרשאת הוספה או מחיקה למשתמש רגיל. ביטול טרנזקציה מבטל גם את הגדלת המונה.

`supplier_detail(supplier_id uuid)` מחזירה `identifiers` לפי RLS (מספר זהות של אדם פרטי רק לעורך ולמנהל), `contacts` הנוכחיים לפי RLS, ו־`audit` למנהל או מבקר בלבד. לאחרים `audit: null`. גילוי רשומות שנמחקו או הועברו לספק אחר נעשה דרך יומן השינויים; התאמת רשומות נעשית גם לפי שם הטבלה, כדי לא לערבב מזהים זהים מטבלאות שונות.

בדיקות Advisor ומדידות על `hmophbeqelaycjdvgkys` יבוצעו בידי Claude אחרי המיזוג והפריסה האוטומטית לסביבת הבדיקה, לפי הנחיית בעל המוצר. בדיקות PGlite הן מבודדות ואינן מדידת רשת או תחליף ל־Advisor. אין במימוש זה אישור למיזוג או לפריסה לחי.
