// Hebrew names for the slugs the tracker sends. An unknown slug is shown as it is.
export { ROLE_NAMES, roleLabel, screenLabel } from '../../../lib/screen-names.ts';

const ACTIONS: Record<string, string> = {
  'catalog.search': 'חיפוש ספקים',
  'catalog.filters-open': 'פתיחת מסננים',
  'catalog.filters-apply': 'הצגת תוצאות מסננים',
  'catalog.reset': 'ניקוי החיפוש והמסננים',
  'catalog.filters-clear': 'ניקוי המסננים בחלון',
  'catalog.clear-filters': 'ניקוי כל המסננים',
  'shortlist.clear': 'ניקוי רשימת הספקים לבקשה',
  'request.next': 'המשך לפרטי הבקשה',
  'request.check': 'בדיקת מסלול התקשרות',
  'request.clear': 'ניקוי פרטי הבקשה',
  'request.approach': 'רישום פנייה לספקים',
  'request.bcc': 'העתקת כתובות ל-BCC',
  'request.export': 'ייצוא לקובץ',
  'request.share': 'העתקת קישור לבקשה',
  'supplier.copy': 'העתקת פרט ספק',
  'supplier.add': 'הוספת ספק',
  'supplier.save': 'שמירת שינוי בספק',
  'login.email': 'כניסה בקישור למייל',
  'login.google': 'כניסה עם Google',
  'portal.link': 'שיוך לספק באזור האישי',
  'portal.person': 'שמירת פרטים אישיים',
  'portal.upload': 'העלאת מסמך',
  'portal.propose': 'הצעת תיקון',
};

const FILTER = /^catalog\.(filter|toggle)\.(.+)$/;
const FILTER_NAMES: Record<string, string> = {
  registry: 'מאגר',
  field: 'תחום',
  category: 'קטגוריה',
  subcategory: 'תת־קטגוריה',
  unit: 'יחידה',
  validity: 'תוקף',
  identifier: 'ח.פ.',
  venue: 'מתקנים ואולמות',
  showInactive: 'כולל לא פעילים',
  showClosed: 'כולל מאגרים סגורים',
};

export function actionLabel(action: string): string {
  const filter = FILTER.exec(action);
  if (filter) {
    const name = filter[2] ?? '';
    return `${filter[1] === 'filter' ? 'סינון' : 'הצגה'}: ${FILTER_NAMES[name] ?? name}`;
  }
  return ACTIONS[action] ?? action;
}
