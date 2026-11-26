# כלי העבודה של האתר ב-React

תאריך: 16.11.2026. מצב: התקבלה (16.11.2026, עם מיזוג #45).

## הקשר

החלטה 0001 קבעה שהאתר עובר ל-React, אבל לא קבעה ניתוב, ניהול מצב, טפסים, עיצוב ובדיקות של קומפוננטות. כללי הקוד אוסרים תלות חדשה בלי החלטה מתועדת. בנוסף, Node מריץ TypeScript ישירות אבל לא JSX, ולכן `node --test` לבדו לא יכול לבדוק קומפוננטות.

## ההחלטה

- React 19 עם React Compiler דרך `@vitejs/plugin-react`. לא כותבים `useMemo`, `useCallback` או `memo` ידנית.
- React Router 8 במצב ספרייה עם `createHashRouter`, ומסכים שנטענים ב-`lazy`. GitHub Pages לא מחזיר את הדף לכתובת עמוקה, ו-hash עובד בלי עקיפה.
- אין ספריית מצב או מטמון נתונים (Redux, Zustand, TanStack Query). הקטלוג נשמר במאגר אחד ב-`web/src/data/` לפי אפיון טעינת המידע, ומסכים קוראים ממנו ב-`useSyncExternalStore`. עדכון 18.11.2026: נתוני מסך נשמרים בזיכרון לפי מפתח ב-`web/src/data/screen-data.ts`, וטיוטות טפסים ב-`sessionStorage`, עדיין בלי ספרייה. ההחלטה והתנאים לחזור אליה: [אפיון ניהול state](../state-management-spec-he.md).
- טפסים ב-`<form action>` ו-`useActionState` של React 19, ואימות ב-Zod 4 (כבר הוחלט ב-0001).
- CSS רגיל: משתנים, `@layer`, nesting ו-CSS Modules שמובנים ב-Vite. אין ספריית רכיבים ואין Tailwind.
- בדיקות קומפוננטות ב-Vitest עם Testing Library ו-jsdom. קובצי `.ts` ממשיכים לרוץ ב-`node --test`. בדיקות קצה לקצה ב-Playwright.
- ESLint מקבל את `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y-x` ו-`eslint-plugin-import-x` (לאכיפת הכלל שפיצ'ר לא מייבא פיצ'ר אחר).
- תקציב גודל לחבילה נבדק ב-CI: עד 150KB gzip בטעינה ראשונה, ועד 40KB לכל מסך.

## השלכות

כעשר תלויות פיתוח חדשות, ושלוש תלויות זמן ריצה: `react`, `react-dom` ו-`react-router` (Zod כבר הוחלט ב-0001). המעבר מ-hash לכתובות רגילות יידרש רק אם האתר יעבור לאירוח שמחזיר את הדף לכל כתובת. האתר לא עובר ל-`supabase-js`, בניגוד למה שנכתב ב-0001: במדידה (16.11.2026) הוא שוקל כ-56KB gzip, ויחד עם React והנתב (כ-98KB) זה עובר את תקציב הטעינה הראשונה. הלקוח הקיים, שכתוב ביד, נשאר.

פירוט הכללים: [מדריך React](../react-guide-he.md). חלוקת העבודה: [תוכנית העבודה](../react-work-plan-he.md).
