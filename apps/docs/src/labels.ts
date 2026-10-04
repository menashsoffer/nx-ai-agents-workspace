import type { DefaultTheme } from 'vitepress';

/** Hebrew text for the default theme's built-in UI. */
export const THEME_LABELS: DefaultTheme.Config = {
  outline: { label: 'בעמוד הזה', level: [2, 3] },
  docFooter: { prev: 'הקודם', next: 'הבא' },
  darkModeSwitchLabel: 'מראה',
  lightModeSwitchTitle: 'מעבר למראה בהיר',
  darkModeSwitchTitle: 'מעבר למראה כהה',
  sidebarMenuLabel: 'תפריט',
  returnToTopLabel: 'חזרה למעלה',
  langMenuLabel: 'החלפת שפה',
  navMenuLabel: 'ניווט ראשי',
  mobileMenuLabel: 'תפריט',
  extraMenuLabel: 'אפשרויות נוספות',
  skipToContentLabel: 'דלגו לתוכן',
  notFound: {
    title: 'הדף לא נמצא',
    quote: 'ייתכן שהקובץ הועבר או שונה שמו. נסו לחפש או לחזור לדף הבית.',
    linkLabel: 'לדף הבית של התיעוד',
    linkText: 'לדף הבית של התיעוד',
  },
};

export const SEARCH_TRANSLATIONS: NonNullable<
  Extract<DefaultTheme.Config['search'], { provider: 'local' }>['options']
>['translations'] = {
  button: { buttonText: 'חיפוש', buttonAriaLabel: 'חיפוש בתיעוד' },
  modal: {
    displayDetails: 'הצגת פירוט',
    resetButtonTitle: 'ניקוי החיפוש',
    backButtonTitle: 'סגירת החיפוש',
    noResultsText: 'לא נמצאו תוצאות עבור',
    footer: {
      selectText: 'בחירה',
      selectKeyAriaLabel: 'Enter',
      navigateText: 'ניווט',
      navigateUpKeyAriaLabel: 'חץ למעלה',
      navigateDownKeyAriaLabel: 'חץ למטה',
      closeText: 'סגירה',
      closeKeyAriaLabel: 'Escape',
    },
  },
};
