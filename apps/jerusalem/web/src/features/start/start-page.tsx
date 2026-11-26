// "איך מתחילים" (alignment review, stage C, 25.11): the path of one request from finding a
// supplier to choosing a winner, in the order the screens are used. Static text only.
import { Link } from 'react-router';
import { PageHeader } from '../../ui/page-header.tsx';
import styles from './start.module.css';

interface Step {
  title: string;
  text: string;
  to: string;
  link: string;
}

export const STEPS: readonly Step[] = [
  {
    title: 'מחפשים ספק',
    text: 'בדף הבית או באיתור ספקים, לפי שם, תחום או מאגר.',
    to: '/catalog',
    link: 'לאיתור ספקים',
  },
  {
    title: 'בודקים אם מותר להתקשר',
    text: 'בראש דף הספק מופיע "מותר", "לא מותר" או "לבדוק", עם מה שנבדק ומה עוד לא.',
    to: '/catalog',
    link: 'לדף ספק מתוך האיתור',
  },
  {
    title: 'פותחים בקשת התקשרות',
    text: 'נושא, יחידה ואומדן. המערכת בודקת לפי הספים של החודש איזה הליך נדרש.',
    to: '/engagement',
    link: 'לבקשה חדשה',
  },
  {
    title: 'פונים לספקים עם מועד לתשובה',
    text: 'הספקים עונים באזור האישי שלהם, או שרושמים תשובה שהגיעה בדוא"ל או בטלפון. סכומי ההצעות נשארים סגורים עד שהמועד עובר.',
    to: '/engagement',
    link: 'לבקשות השמורות',
  },
  {
    title: 'בוחרים זוכה',
    text: 'אחרי המועד ההצעות נפתחות. בוחרים הצעה, ואפשר לכתוב נימוק. הבקשה נסגרת, וכל מי שהגיש רואה אם נבחר. בקשה שלא תתקדם מבטלים עם סיבה.',
    to: '/engagement',
    link: 'לבקשות השמורות',
  },
];

export function StartPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="איך מתחילים"
        lead="המסלול של בקשה אחת, מהחיפוש ועד בחירת הזוכה. מה שמחכה לכם מופיע בדף הבית."
      />
      <ol className={styles.steps}>
        {STEPS.map((step) => (
          <li key={step.title}>
            <h2>{step.title}</h2>
            <p>{step.text}</p>
            <Link to={step.to}>{step.link}</Link>
          </li>
        ))}
      </ol>
      <p>
        מנהלי יחידה ומנהלי מערכת מאמתים גם את המאגרים שלהם:{' '}
        <Link to="/registries">אימות מאגרים</Link>.
      </p>
    </div>
  );
}

export const Component = StartPage;
/** The page is static text; it loads nothing. */
export const loader = () => null;
