# מפת המוצר: מי משתמש, באילו מסכים, ומה כל מסמך

מעודכן ל-25.11.2026. המסמך הזה בא במקום קריאה של כל תיקיית `documentation`: הוא אומר מה קיים היום באתר, למי, ואיזה מסמך אפיון עדיין קובע. כשמסך נוסף או משתנה, מעדכנים כאן שורה אחת.

## למי המערכת

| מי | מה הוא עושה במערכת | איך נכנס |
|---|---|---|
| עובד עירייה (צופה) | מחפש ספק, בודק אם מותר להתקשר איתו, פותח בקשת התקשרות ובודק מסלול | Google או קישור לדוא"ל, אחרי שבקשת הגישה שלו אושרה |
| עורך ביחידה | כמו צופה, ובנוסף מוסיף ספקים ומעדכן את פרטיהם | כמו צופה, עם תפקיד "עורך" ביחידה |
| מנהל יחידה | מאשר בקשות גישה של עובדי היחידה | כמו צופה, עם תפקיד "מנהל יחידה" |
| מנהל מערכת | מאשר מזהים, קטגוריות, ספים, שיוכים וקליטה מאקסל, ורואה שימוש ושגיאות | כמו צופה, עם תפקיד "מנהל מערכת" |
| מבקר | רואה את בקרת הטעינה בלי לשנות דבר | כמו צופה, עם תפקיד "מבקר" |
| ספק | רואה פניות מהעירייה, מגיש הצעה, מעלה מסמכים ומציע תיקון לפרטיו | האזור האישי לספקים, אחרי שיוך לספק |

ההרשאות נאכפות במסד הנתונים (RLS ופונקציות), לא בדפדפן. הפירוט: [web-access-he.md](web-access-he.md).

## המסכים

הכתובות הן אחרי `#` בכתובת האתר.

### לכל העובדים

| מסך | כתובת | מה יש בו | אפיון שקובע |
|---|---|---|---|
| בית | `/` | חיפוש ספק, "מחכה לך", פעולות מהירות ומצב המאגרים. מבקר בלי גישה מועבר לאיתור ספקים | עיצוב שאושר ב-25.11 ([alignment-review-2026-11-25-he.md](alignment-review-2026-11-25-he.md)) |
| איתור ספקים | `/catalog` | חיפוש וסינון לפי תחום, מאגר ותוקף, ומתקנים | [catalog-portal-spec-he.md](catalog-portal-spec-he.md), [catalog-snapshot-contract-he.md](catalog-snapshot-contract-he.md) |
| דף ספק | `/supplier/:id` | פס "מותר / לא מותר / לבדוק", רישום במאגרים, יצירת קשר, זיהוי, מקור המידע, היסטוריה, האזור האישי | [supplier-page-spec-he.md](supplier-page-spec-he.md) |
| עריכת ספק | חלון בדף הספק | שינוי שם, סוג ישות ופרטי קשר, עם בדיקה אוטומטית לפני שמירה | [supplier-edit-checks-spec-he.md](supplier-edit-checks-spec-he.md) |
| הוספת ספק | `/supplier/new` (עורכים) | ספק חדש עם זיהוי כפילויות | [supplier-page-spec-he.md](supplier-page-spec-he.md) |
| בקשות התקשרות | `/engagement` | ספקים לבקשה, פרטים, בדיקת מסלול לפי הספים, רישום פנייה, פניות ותשובות, בחירת זוכה וסגירה, בקשות שמורות | [procurement-engine-he.md](procurement-engine-he.md), [supplier-approaches-spec-he.md](supplier-approaches-spec-he.md) |
| איך מתחילים | `/start` | המסלול של בקשה אחת, מחיפוש ספק ועד בחירת זוכה | [alignment-review-2026-11-25-he.md](alignment-review-2026-11-25-he.md) |
| כניסה והרשאות | `/auth` | כניסה, בקשת גישה, הפרטים והתפקידים שלי | [change-approvals-he.md](change-approvals-he.md) |

### ניהול

| מסך | כתובת | למי | מה יש בו |
|---|---|---|---|
| ניהול | `/admin` | כל מי שיש לו לפחות מסך ניהול אחד | רשימת המסכים ומה מחכה בכל אחד |
| משתמשים ותפקידים | `/users` | מנהל יחידה, מנהל מערכת | אישור בקשות גישה ומתן תפקידים |
| אימות מאגרים | `/registries` | מנהל יחידה (של המאגר), מנהל מערכת | "בתוקף עד" לכל מאגר, ובדיקה של כל ספק מול מסמך המאגר: מופיע או לא תואם, עם סיבה |
| מועמדי מזהה ספק | `/identifiers` | מנהל מערכת | אישור ח.פ. או מספר עמותה שנמצאו ברשם, והצעות לסוג ישות |
| בקשות קטגוריה | `/categories` | מנהל מערכת | שיוך תחומי המקור לקטגוריות |
| אישור הסף החודשי | `/thresholds` | מנהל מערכת | אישור הספים שחושבו ממדד הלמ"ס ([threshold-history-he.md](threshold-history-he.md)) |
| כתובות לבדיקה | `/addresses` | מנהל מערכת | כתובות שלא נמצאו במפה |
| שיוכים לאזור האישי | `/supplier-links` | מנהל מערכת | בקשות של אנשים להשתייך לספק |
| קליטת ספקים מאקסל | `/import` | מנהל מערכת | העלאה, בדיקה ואישור ([supplier-excel-import-spec-he.md](supplier-excel-import-spec-he.md)) |
| בקרת טעינה | `/load-control` | מנהל מערכת, מבקר | שיוכים ומסמכים שמחכים לבדיקה |
| שימוש באתר | `/usage` | מנהל מערכת | מי נכנס ומה נעשה ([usage-analytics-spec-he.md](usage-analytics-spec-he.md)) |
| שגיאות באתר | `/errors` | מנהל מערכת | מה הייתה כל שגיאה ([error-details-spec-he.md](error-details-spec-he.md)) |

### לספקים

| מסך | כתובת | מה יש בו | אפיון |
|---|---|---|---|
| האזור האישי | `/supplier-area` | מה חסר לי, פניות והגשת הצעה, הפרטים שלי, המאגרים שלי, מסמכים, המשתמשים שלנו | [supplier-portal-spec-he.md](supplier-portal-spec-he.md) |
| כניסה לספקים | `/supplier-area/login` | כניסה ושיוך לספק | [supplier-portal-spec-he.md](supplier-portal-spec-he.md) |

## המסלולים העיקריים, ואיפה הם נבדקים

| מסלול | בדיקת דפדפן |
|---|---|
| עובד חדש נכנס, מבקש גישה ומקבל אותה | `e2e/tests/access-test.ts` |
| מחפשים ספק, רואים אם מותר להתקשר, ומעדכנים פרט | `e2e/tests/supplier-test.ts` |
| בקשה, בדיקת מסלול, פנייה, והצעה של הספק באזור האישי | `e2e/tests/approach-test.ts` |
| האתר המפורסם נפתח אחרי כל פריסה | `e2e/smoke/site-test.ts` |

איך מריצים: [e2e-tests-he.md](e2e-tests-he.md).

## מה עוד לא קיים

לפי סדר העבודה שאושר ב-25.11 ([alignment-review-2026-11-25-he.md](alignment-review-2026-11-25-he.md)):

1. **בדיקות הרשמים (שלב ב):** מסך אימות המאגרים קיים (כל ספק בנפרד, החלטת מנשה מ-25.11), אבל עד שהשיוכים ייבדקו בו רוב הספקים מוצגים "לבדוק". בדיקות הרשמים מ-data.gov.il נוספו ב-25.11: רשם העמותות, אישור ניהול תקין לשנה הנוכחית, אירועים ב-12 החודשים האחרונים, סימון חברה מפרה, תת סטטוס ושנת הדוח השנתי האחרון. דף הספק מציג מה נבדק, מה לא נבדק ומה סומן, ולעולם לא "תקין". הבדיקה היומית שואלת רק על מספרים מאושרים (החלטת מנשה מ-25.11). מספר שאושר אחרי תשובה ישנה, בלי הבדיקות החדשות, נבדק מיד. עוד חסרים רשם השותפויות ורשם האגודות השיתופיות.
2. **סגירת בקשה (שלב ג):** בחירת זוכה נבנתה ב-25.11. רק הצעה שנפתחה (אחרי המועד) יכולה לזכות, והנימוק לא חובה. כל ספק שהגיש רואה באזור האישי אם נבחר, בלי שם הזוכה ובלי סכומים (החלטת מנשה מ-25.11). בקשה בלי זוכה מבוטלת עם סיבה. בדף הבית מופיע "מחכה לבחירת זוכה". נשאר: מעבר של בקשה בסביבת הבדיקה מפתיחה ועד זוכה, וזה שער השלב.
3. **פיילוט (שלב ד):** 3 עד 5 עובדים מיחידה אחת. היחידה תיבחר בערך בשבוע הקרוב.
4. **חוזים, הזמנות, מכרזים ומסגרות:** מאופיינים ב-[procurement-journey-spec-he.md](procurement-journey-spec-he.md), ולא נבנים לפני שלבים ב-ד.
5. **דוחות הוועדה לפטור ממכרז (OCR):** מחכים למפתח ולתקציב (#152).

## מה כל מסמך, ומה מהם עדיין קובע

**כללים שתמיד חלים:** [coding-standards-he.md](coding-standards-he.md) · [react-guide-he.md](react-guide-he.md) · [../DESIGN.md](../DESIGN.md) · [ui-building-blocks-spec-he.md](ui-building-blocks-spec-he.md) · [error-handling-spec-he.md](error-handling-spec-he.md) · [state-management-spec-he.md](state-management-spec-he.md) · [validation-rules-he.md](validation-rules-he.md) · [change-approvals-he.md](change-approvals-he.md) · [environments-he.md](environments-he.md) · [database-he.md](database-he.md) · [e2e-tests-he.md](e2e-tests-he.md)

**הכיוון והתוכנית:** [alignment-review-2026-11-25-he.md](alignment-review-2026-11-25-he.md) קובע את סדר העבודה עכשיו. [architecture-plan-he.md](architecture-plan-he.md) קובע את המבנה (Supabase כשרת יחיד, GitHub Actions לעבודות כבדות). [decisions/](decisions/) הן ההחלטות.

**אפיון של מה שכבר בנוי:** catalog-portal, catalog-snapshot-contract, supplier-page, supplier-edit-checks, supplier-portal, supplier-approaches, supplier-excel-import ו-excel-import-errors, supplier-import-api, procurement-engine, usage-analytics, error-details, web-access, web-monitoring, threshold-history, pool-file-load.

**אפיון שאושר ועוד לא נבנה:** [procurement-journey-spec-he.md](procurement-journey-spec-he.md).

**מחקר ורקע:** [supplier-system-spec-he.md](supplier-system-spec-he.md) (המיפוי הראשון), [legal-research-he.md](legal-research-he.md), [data-sources-he.md](data-sources-he.md), [guidestar-api-he.md](guidestar-api-he.md), [identifier-feasibility-he.md](identifier-feasibility-he.md), [database-design-spec-he.md](database-design-spec-he.md) (המודל שעליו נבנה המסד), [product-design-he.md](product-design-he.md).

**היסטוריה, הושלמו או הוחלפו:** [task-spec-he.md](task-spec-he.md) (הוחלף בתוכנית הארכיטקטורה ובסקירת היישור), [react-work-plan-he.md](react-work-plan-he.md) (המעבר ל-React הושלם), [data-loading-spec-he.md](data-loading-spec-he.md) (מומש), [screens-spec-he.md](screens-spec-he.md) (הצעה ראשונה; המסכים נבנו לפי האפיונים הייעודיים).

כשיש סתירה בין מסמך לקוד, הקוד והמסד החי קובעים, ומתקנים את המסמך.
