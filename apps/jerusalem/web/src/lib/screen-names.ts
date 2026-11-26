// Hebrew names for screen and role slugs, shared by the usage and error screens.
// An unknown slug is shown as it is.
export type RoleSlug =
  'admin' | 'auditor' | 'unit_manager' | 'editor' | 'viewer' | 'supplier' | 'other';

export const ROLE_NAMES: Record<RoleSlug, string> = {
  admin: 'מנהל מערכת',
  auditor: 'מבקר',
  unit_manager: 'מנהל יחידה',
  editor: 'עורך',
  viewer: 'צופה',
  supplier: 'ספק',
  other: 'ללא הרשאה',
};

const SCREENS: Record<string, string> = {
  catalog: 'איתור ספקים',
  supplier: 'כרטיס ספק',
  'supplier-new': 'הוספת ספק',
  engagement: 'בקשות התקשרות',
  admin: 'ניהול',
  categories: 'בקשות קטגוריה',
  identifiers: 'מזהי ספקים',
  addresses: 'כתובות לבדיקה',
  'load-control': 'בקרת טעינה',
  users: 'משתמשים ותפקידים',
  'supplier-links': 'שיוכים ומסמכים',
  thresholds: 'הסף החודשי',
  auth: 'כניסה והרשאות',
  usage: 'שימוש באתר',
  import: 'קליטת ספקים מאקסל',
  errors: 'שגיאות באתר',
  'supplier-area': 'אזור אישי לספקים',
  'not-found': 'דף לא נמצא',
  home: 'דף הבית',
  other: 'אחר',
};

export function screenLabel(screen: string): string {
  const known = SCREENS[screen];
  if (known) return known;
  // The longest known prefix: "supplier-area-login" belongs to "supplier-area", not "supplier".
  const parent = Object.keys(SCREENS)
    .filter((key) => screen.startsWith(`${key}-`))
    .sort((a, b) => b.length - a.length)[0];
  return parent ? `${SCREENS[parent] ?? parent} (${screen.slice(parent.length + 1)})` : screen;
}

export function roleLabel(role: string): string {
  return Object.entries(ROLE_NAMES).find(([key]) => key === role)?.[1] ?? role;
}
