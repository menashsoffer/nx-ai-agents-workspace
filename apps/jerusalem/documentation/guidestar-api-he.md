# ממשק ה-API של גיידסטאר

עודכן ב-22.11.2026 מתוך מפרט ה-OpenAPI הרשמי ב-SwaggerHub
(`https://app.swaggerhub.com/apis-docs/justice/guidestar/1.4`, גרסה 1.4), שנקרא דרך הדפדפן.
הגרסה הקודמת נכתבה ב-13.11.2026 מתוך פורטל הממשק `https://api.guidestar.org.il/s/` (דורש כניסה).

איש קשר מטעם משרד המשפטים לפי המפרט: `guidestar@justice.gov.il`.

## מה הממשק מכסה

גיידסטאר הוא אתר של משרד המשפטים על **ארגונים ללא כוונת רווח**: עמותות, חברות לתועלת הציבור
(חל"צ) והקדשות. אין בו חברות בע"מ רגילות. לכן הוא מכסה רק חלק מהספקים. למספר חברה של חברה בע"מ
צריך את מאגר רשם החברות (data.gov.il), שלא דורש חשבון.

הממשק לקריאה בלבד. אין בו קריאה שמשנה נתונים.

## גישה וכניסה

- כתובת בסיס: `https://www.guidestar.org.il/services/apexrest/api`
- כניסה: `POST /login` עם גוף JSON:

  ```json
  { "username": "<שם המשתמש של החשבון>", "password": "<הסיסמה>" }
  ```

  התשובה: `{ "sessionId": "..." }`.
- כל קריאה אחרת שולחת את הכותרת `Authorization: Bearer <sessionId>`.
- במפרט מופיעה גם הגדרת OAuth2 עם כתובת `example.com`. זו דוגמה שנשארה בתבנית ולא בשימוש.
  הכניסה בפועל היא רק דרך `/login`.
- המפרט לא אומר כמה זמן `sessionId` תקף ולא מציין מגבלת קצב. לכן הפונקציה שלנו נכנסת מחדש בכל
  בקשה, ולא שומרת את האסימון.
- פרטי החשבון נשמרים כסוד של Supabase Edge Functions בלבד, לא בקוד, לא באתר ולא ב-GitHub.
  ראו "חיבור ל-Supabase" למטה.

## כל נקודות הקצה

כל הקריאות הן `GET` חוץ מ-`/login`, וכולן דורשות את אסימון ה-Bearer.

| קריאה | מה מחזירה | פרמטרים |
| --- | --- | --- |
| `POST /login` | `sessionId` | גוף: `username`, `password` |
| `GET /organizations` | רשימת ארגונים | `filter`, `sort`, `isDesc`, `fullObject` |
| `GET /organizations/{regNum}` | ארגון אחד לפי מספר תאגיד | `fullObject` |
| `GET /organizations/{regNum}/branches` | סניפי הארגון ושמות השירותים בהם | `filter`, `sort` (ברירת מחדל `branchId`), `isDesc` |
| `GET /organizations/{regNum}/services` | השירותים שהארגון נותן | `filter`, `sort`, `isDesc` |
| `GET /organizations/{regNum}/reports` | דוחות הארגון (גרסה ישנה) | `filter` |
| `GET /organizations/{regNum}/reports2` | דוחות הארגון (גרסה 1.4, מומלצת) | `filter` |
| `GET /organizationReports` | דוחות של כל הארגונים | `filter` |
| `GET /organizationReports/{guid}` | קובץ דוח אחד (גרסה ישנה, `fileName` ו-`body`) | — |
| `GET /organizationReports2` | דוחות של כל הארגונים (גרסה 1.4) | `filter` |
| `GET /organizationReports2/{guid}` | קישור הורדה לדוח אחד (גרסה 1.4) | — |
| `GET /organizationBranches` | סניפים של כל הארגונים | `filter`, `sort` (ברירת מחדל `branchId`), `isDesc` |
| `GET /organizationServices` | שירותים של כל הארגונים | `filter`, `sort` (ברירת מחדל `serviceId`), `isDesc` |

`{regNum}` הוא מספר התאגיד (למשל `580030104`). `{guid}` הוא מזהה הדוח מתוך רשימת הדוחות.

### `fullObject`

ב-`/organizations` וב-`/organizations/{regNum}`: עם `fullObject=true` מתקבל המודל המלא
(`Organization-Full`), עם כתובת, טלפונים, מנכ"ל, מחזור ועוד. בלי הפרמטר מתקבל המודל המקוצר
(`Organization`).

### דוחות: גרסה ישנה מול גרסה 1.4

הדוחות מוחזרים רק לשלוש השנים האחרונות (ב-2026: 2023 עד 2026).

ב-`reports2` וב-`organizationReports2` השדה `link` הוא אחד משניים:

1. קישור הורדה ישיר לקובץ (כתובת של `justice-il.my.salesforce.com`), אם הקובץ כבר הוכן.
2. נתיב `/services/apexrest/api/organizationReports2/{guid}`, אם הקובץ עוד לא הוכן.

במקרה השני קוראים ל-`GET /organizationReports2/{guid}`, והתשובה בתבנית `FileV1.4`:
`isSuccess`, `status`, `linkToFile`, `message`. **גם תשובה 200 לא אומרת שהקובץ מוכן**: רק כש-`status`
הוא `Success` יש קישור ב-`linkToFile`. עד אז חוזרים לשאול את אותה כתובת, בהפסקות.

## סינון (`filter`)

- כמה תנאים מפרידים ב-`;`, בלי רווחים.
- אפשר לסנן לפי כל שדה של הסכמה המוחזרת.
- האופרטורים לפי המפרט: `=:` (אחד מרשימה, ערכים מופרדים בפסיק), `!=`, `>=`, `<=`, `=`, `>`, `<`.
- דוגמה מהמפרט:

  ```text
  regNum=:580462224,580462208;lastModifiedDate>=2023-06-18T15:34:39.000+0000
  ```

  כלומר: שני ארגונים מסוימים, ששונו מ-18.6.2023 והלאה.
- את הערך של `filter` מקודדים כרכיב כתובת (`encodeURIComponent`).
- `sort` מקבל שם שדה, ו-`isDesc=true` הופך את הסדר.

המפרט לא מסביר אם `=` על שדה טקסט (למשל `name`) הוא התאמה מדויקת או חלקית. צריך לבדוק עם החשבון.

## דפדוף

כל תשובה של רשימה מחזירה עד 200 רשומות. כשיש עוד, מגיעה כותרת `Link` עם הכתובת למקטע הבא,
בתבנית `<...&lastId=...&lastValue=...>; rel="next"`. ממשיכים לקרוא לכתובת שבכותרת עד שהיא לא
מופיעה. לחיפוש ספק לפי שם מספיק המקטע הראשון. לסנכרון מלא צריך לעבור על כל המקטעים.

## שגיאות

מבנה שגיאה אחיד: `{ "success": false, "errorMsg": "Bad Request" }`.

## השדות

### ארגון (`Organization`)

| שדה | משמעות |
| --- | --- |
| `regNum` | מספר התאגיד (מחרוזת) |
| `name`, `fullName` | שם הארגון, ושם מלא |
| `malkarType` | סוג התאגיד (עמותה, חל"צ, הקדש) |
| `malkarStatus`, `isActive` | מצב התאגיד, והאם פעיל |
| `approval46` | יש אישור לפי סעיף 46 לפקודת מס הכנסה |
| `hasNihulTakin` | יש אישור ניהול תקין |
| `hasReportsLast2Years`, `hasSubmittedPapers` | הגיש דוחות בשנתיים האחרונות, הגיש מסמכים |
| `orgYearFounded` | שנת הקמה |
| `primaryClassifications`, `secondaryClassifications` | תחומי פעילות (ומספריהם ב-`...Nums`) |
| `branchCount`, `servicesCount` | מספר סניפים ושירותים |
| `volunteerProjectId` | מזהה פרויקט התנדבות |
| `urlGuidestar` | קישור לדף הארגון באתר גיידסטאר |
| `lastModifiedDate` | מתי השתנה לאחרונה |

### ארגון מלא (`Organization-Full`), מעבר לשדות שלמעלה

| שדה | משמעות |
| --- | --- |
| `hasNihulTakinForNextYear` | יש ניהול תקין לשנה הבאה |
| `lastNihulTakinReportDate`, `lastNihulTakinReportURL` | תאריך וקישור של אישור הניהול התקין האחרון |
| `govCertURL` | קישור לאישור הממשלתי |
| `lastFinancialReportYear`, `lastFinancialReportURL` | הדוח הכספי האחרון |
| `lastDescriptiveReportYear`, `lastDescriptiveReportURL` | הדוח המילולי האחרון |
| `addressCity`, `addressStreet`, `addressHouseNum`, `addressZipCode`, `fullAddress` | כתובת |
| `email`, `tel1`, `tel2`, `website` | פרטי קשר |
| `ceoName` | שם המנכ"ל |
| `abbreviatedOrgName`, `regulationType` | שם מקוצר, סוג הסדרה |
| `orgGoal`, `activityAreas` | מטרות ואזורי פעילות |
| `establishedDate` | תאריך ייסוד |
| `turnover`, `isYearDeficit`, `isDeficitYear` | מחזור, והאם הייתה שנת גירעון |
| `employeesNum`, `volunteersNum` | עובדים ומתנדבים |
| `hasGovServices3Years`, `hasGovSupports3Years` | קיבל כספי שירותים או תמיכות ממשלתיות בשלוש השנים האחרונות |

### דוח (`Report`)

`guid`, `type` (למשל "אישור ניהול תקין"), `year`, `link`, `organizationRegNum`, `organizationName`,
`lastModifiedDate`, `fileBigSize`, `mojIdRepo`.

### סניף (`Branch`)

`branchId`, `regNum`, `cityCode`, `cityName`, `district`, `streetCode`, `streetName`, `houseNum`,
`alternateAddress`, `drivingInstructions`, `type`, `language`, `hasReception`, `branchURL`,
`placeNickname`, `itmEast`, `itmNorth`, `latitude`, `longitude`, `phone`, `services`.

### שירות (`Service`)

שירות שהארגון נותן: `serviceId`, `serviceName`, `serviceTypeName`, `serviceMainClassification`,
`serviceSecondaryClassification`, `description`, `area`, `serviceTargetAudience`, `paymentMethod`,
`startDate`, `endDate`, `phone`, `email`, `url`, `branches` ועוד. כמה שדות הם רשימות מופרדות ב-`;`.

לשירות ממשלתי יש `serviceGovName`. אם `relatedMalkarService` מלא, הוא מצביע על השירות של הארגון
עצמו. במקרה כזה המפרט ממליץ להציג רק את השירות של הארגון, כדי לא להציג אותו פעמיים.

## איך אנחנו משתמשים בזה

הפונקציה `supplier-identifiers` (`supabase/functions/supplier-identifiers/`) כבר פרוסה:

1. נכנסת עם `GUIDESTAR_USERNAME` ו-`GUIDESTAR_PASSWORD`. בלי הסודות האלה היא מדלגת על גיידסטאר
   (מצב `not_configured`) ומחפשת רק ברשם החברות.
2. מחפשת כל שם של הספק ב-`GET /organizations?filter=name=<שם>`. שם עם `;`, `=`, `<` או `>` לא
   נשלח, כי התווים האלה שייכים לתחביר הסינון.
3. מתרגמת `malkarType`: עמותה לסכמה `nonprofit`, חל"צ לסכמה `company`. הקדש עדיין לא נשמר.
4. שומרת את התוצאות **כמועמדים בלבד** (`identifier_candidates`). מזהה נכנס ל-`supplier_identifiers`
   רק אחרי שעורך מאשר ואדם שני מאמת.

### בדיקה לפי מספר (שלב 2 בבדיקות עריכת ספק)

הפונקציה `supplier-change-check` (`supabase/functions/supplier-change-check/`) רצה לפני בדיקה של
שינוי שם או סוג ישות בחלון העריכה:

- לכל מספר עמותה של הספק: `GET /organizations/{regNum}?fullObject=true`. נשמרים השם,
  `malkarStatus`, ו-`isActive`, `hasNihulTakin`, `hasNihulTakinForNextYear`, `approval46`,
  `malkarType` ו-`urlGuidestar` בעמודה `registry_details` של המזהה. `isActive` שקר נשמר כסטטוס
  "לא פעיל" גם כש-`malkarStatus` לא אומר זאת. תשובה 404 נשמרת כ"לא נמצא במרשם".
- מספר חברה (כולל חל"צ) נבדק ברשם החברות ב-data.gov.il, לפי `filters` על "מספר חברה".
- מספר שנבדק ב-24 השעות האחרונות לא נשאל שוב. כל קריאה נספרת במכסה של 30 בשעה, כמו החיפוש.
- התשובה נשמרת במסד עם מפתח השירות, ובדיקות העריכה קוראות אותה משם. גוף שנמחק או לא פעיל מסמן
  את הספק "לבדיקה", ובחלון העריכה מופיעה אזהרה צהובה.
- לא לשמור מגיידסטאר את פרטי הקשר כאמת. הם נכנסים, אם בכלל, כהצעה שאדם מאשר.

## לפני שמשתמשים

בפורטל הממשק יש דף "הסתייגויות לנתונים בממשק". הנתונים נאספים ממקורות שונים, ולכן מזהה שהגיע
מגיידסטאר עדיין עובר אימות של אדם (משימה ה2 באפיון). שם דומה אינו הוכחה שזה אותו ספק.

מה עוד לא נבדק, כי אין לנו גישה לחשבון מכאן: משך תוקף ה-`sessionId`, מגבלת קצב, ואם `name=` הוא
התאמה מדויקת או חלקית. כדאי לבדוק את שלושתם בהרצה הראשונה עם החשבון.

## חיבור ל-Supabase

הסודות מוזנים ידנית על ידי בעל החשבון. לא מדביקים אותם בצ'אט, בקוד או ב-GitHub.

1. נכנסים ל-`https://supabase.com/dashboard` ובוחרים בפרויקט החי (`jzsvhjkiklfnogseelbe`).
2. בתפריט הצד: **Edge Functions**, ואז **Secrets** (בחלק מהגרסאות: Project Settings, ואז Edge
   Functions).
3. מוסיפים שני סודות, בדיוק בשמות האלה:
   - `GUIDESTAR_USERNAME`: שם המשתמש של חשבון הממשק בגיידסטאר.
   - `GUIDESTAR_PASSWORD`: הסיסמה שלו.
4. לוחצים **Save**. הפונקציות קוראות את הסודות בכל הפעלה, ולכן אין צורך לפרוס מחדש.
5. בדיקה: ברשימת ה-Secrets צריכים להופיע שני השמות. הערכים עצמם לא מוצגים, וזה תקין.
   באתר עוד אין מסך שמפעיל את החיפוש (מסך מזהי הספקים בשלב 3). כשהוא ייבנה, חיפוש על ספק שהוא
   עמותה אמור להחזיר מועמדים ממקור גיידסטאר. אם מגיעות רק תוצאות מרשם החברות, בודקים ב-Edge
   Functions, ואז `supplier-identifiers`, ואז Logs.
6. בסביבת הבדיקה (`hmophbeqelaycjdvgkys`) לא חובה להוסיף את הסודות. בלעדיהם החיפוש רץ שם רק ברשם
   החברות, וזה מספיק לנתוני דמה.

אם הסיסמה של החשבון משתנה, מעדכנים את `GUIDESTAR_PASSWORD` באותו מסך.
