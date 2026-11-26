# טיוטת ממשק ייבוא ספקים

שלב 1 (מסד) של אפיון הקליטה מאקסל. נבנה בקודקס ב-17.11.2026 והועבר ל-main ב-22.11.2026,
במיגרציה `20261123160000_excel_import.sql`. כל הפעולות למנהל פעיל בלבד.

`stage_excel_import(batch)` מקבל אובייקט עם `file_name`, `storage_path`, `content_sha256`,
`url` ו-`published_on` אופציונליים, `registry_id` ו-`registry_version_id` אופציונליים,
או `registry_name` ליצירת מאגר. אם נבחר מאגר ללא גרסה, נוצרת לו גרסה חדשה. `rows` היא
מערך של עד 5,000 עצמים עם `row_number`, `raw` ו-`edited`. הערכים הממופים ב-`edited` הם
מחרוזות: `name`, `entity_kind`, `scheme`, `value`, `field`, `phone`, `email`, `address`,
`contact_person`, `website`. `raw` שומר את הנתונים כפי שנקראו. התוצאה מכילה מזהה אצווה
ומועמדי התאמה, או סימון קובץ חוזר. מועמדים אינם החלטות. אפשר לשלוח רק `batch_id`
כדי לטעון מחדש הצעות התאמה לשורות הממתינות בטיוטה קיימת.

`decide_import_rows(decisions)` מקבל מערך של `row_id`, החלטה (`new`, `link`, `hold` או
`skip`) ו-`edited`. בהחלטת `link` נדרש `target_supplier_id`; בדילוג נדרש `note`. כל הכרעה נשמרת עם מי הכריע
(`decided_by`) ומתי (`decided_at`), כדי שדוח התוצאות יראה מי אישר כל שורה.

`apply_import_batch(batch)` מקבל מזהה אצווה ומחזיר ספירות `promoted`, `failed`, `pending`.
שורה שכבר קודמה אינה מטופלת שוב; כל שורה מוכרעת מטופלת בתת-טרנזקציה. שגיאה משאירה
אותה ממתינה. שורה ללא החלטה נשארת ממתינה.

## פערים שנשארו

- ערך `content_sha256` מחושב בדפדפן. המסד בודק פורמט, קיום קובץ בדלי וגודל, אבל לא קורא את
  הקובץ עצמו. זיהוי קובץ חוזר הוא לכן הגנה מפני טעות, לא הוכחת זהות של הקובץ.
- הבדיקות רצות על PGlite (כולל pgTAP). הרצה מול Supabase אמיתי תהיה בהחלה לייצור.
- סוגי ספק תקינים לפי המסד הנוכחי: `company`, `sole_trader`, `nonprofit`, `partnership`,
  `cooperative`, `public_body`, `unknown` (אדם פרטי נשמר כ-`sole_trader` מ-22.11).
