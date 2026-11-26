import { EXEMPTION_COMMITTEE, TENDER_COMMITTEE } from './decision.ts';

export interface Exemption {
  readonly regulation: string;
  readonly approver: string;
  /** Facts that must all be confirmed. Key: fact code. Value: what it means. */
  readonly requiredFacts: Readonly<Record<string, string>>;
  readonly requirements: readonly string[];
  /** Conditions the engine does not check. Any entry keeps the result at needs_review. */
  readonly unmodeled: readonly string[];
}

const BY_PROCEDURE = 'לפי נוהל העירייה';

export const EXEMPTIONS: Readonly<Record<string, Exemption>> = {
  '3(4)': {
    regulation: '3(4)',
    approver: TENDER_COMMITTEE,
    requiredFacts: {
      sole_supplier_expert_opinion:
        'חוות דעת בכתב של מומחה שמינתה הוועדה שהספק או המומחה יחיד בארץ',
    },
    requirements: ['אישור הוועדה לחוות הדעת'],
    unmodeled: [],
  },
  '3(6)': {
    regulation: '3(6)',
    approver: 'לפי נוהל העירייה, עם דיווח לוועדה',
    requiredFacts: { urgent_life_or_property: 'ההתקשרות דחופה להצלת נפש או רכוש' },
    requirements: ['נימוק הדחיפות ותיעוד בזמן אמת'],
    unmodeled: [],
  },
  '3(8)': {
    regulation: '3(8)',
    approver: EXEMPTION_COMMITTEE,
    requiredFacts: {
      professional_work: 'עבודה מקצועית הדורשת ידע ומומחיות מיוחדים או יחסי אמון מיוחדים',
    },
    requirements: [
      'בחירה מתוך מאגר יועצים לפי חוזר מנכ"ל משרד הפנים 8/2016',
      'פרסום ההחלטה באתר העירייה (לפי החוזר)',
      'נימוק בחירת היועץ מתוך המאגר',
    ],
    unmodeled: [],
  },
  '3(10א)': {
    regulation: '3(10א)',
    approver: BY_PROCEDURE,
    requiredFacts: { counterparty_is_state: 'הצד השני הוא המדינה' },
    requirements: [],
    unmodeled: [],
  },
  '3(14)': {
    regulation: '3(14)',
    approver: BY_PROCEDURE,
    requiredFacts: {
      counterparty_is_npo: 'התאגיד מוכר כמוסד ללא כוונת רווח',
      city_holding_40: 'העירייה מחזיקה 40% לפחות מההון, מההצבעה או מכוח המינוי',
      purpose_education_culture_welfare_sport:
        'מיזם ללא כוונת רווח לחינוך, תרבות, רווחה או ספורט בתחום העירייה',
    },
    requirements: [
      "לקח מעניין התעוררות נ' עיריית ירושלים: נוהל מיזמים משותפים בוטל בבית המשפט, יש לבדוק כל מיזם לגופו",
    ],
    unmodeled: ['התנאים הנוספים שבפסקאות המשנה של תקנה 3(14), כולל מימון התאגיד, לא נבדקו במנוע'],
  },
  '3(16)': {
    regulation: '3(16)',
    approver: BY_PROCEDURE,
    requiredFacts: {
      counterparty_is_local_authority: 'הצד השני הוא רשות מקומית אחרת, בשירות מתחום סמכותה',
      savings_justified: 'העירייה שוכנעה שההתקשרות חוסכת ויעילה',
    },
    requirements: ['תיעוד הנימוק לחיסכון וליעילות'],
    unmodeled: [],
  },
};
