// The template's columns and how a file's headers map to them (spec section 5).

export const FIELDS = [
  'name',
  'entity_kind',
  'scheme',
  'value',
  'field',
  'phone',
  'email',
  'address',
  'contact_person',
  'website',
  'note',
] as const;
export type Field = (typeof FIELDS)[number];

/** The template's header for each field, exactly as the downloadable template writes it. */
export const HEADERS: Record<Field, string> = {
  name: 'שם ספק',
  entity_kind: 'סוג ספק',
  scheme: 'סוג מזהה',
  value: 'מספר מזהה',
  field: 'תחום',
  phone: 'טלפון',
  email: 'דוא״ל',
  address: 'כתובת',
  contact_person: 'איש קשר',
  website: 'אתר',
  note: 'הערה',
};

/** Other headers seen in municipality files, after normalization (see `normalizeHeader`). */
const SYNONYMS: Record<string, Field> = {
  שםהספק: 'name',
  שם: 'name',
  שםהחברה: 'name',
  סוגהספק: 'entity_kind',
  סוגישות: 'entity_kind',
  מספרח: 'value',
  חפ: 'value',
  מספרזיהוי: 'value',
  מספרתאגיד: 'value',
  מספרעוסק: 'value',
  ענף: 'field',
  תחוםפעילות: 'field',
  טל: 'phone',
  נייד: 'phone',
  מספרטלפון: 'phone',
  מייל: 'email',
  אימייל: 'email',
  דואל: 'email',
  דואראלקטרוני: 'email',
  כתובתאתר: 'website',
  אתראינטרנט: 'website',
  הערות: 'note',
  שםאישקשר: 'contact_person',
};

/** Header text without spaces, quotes, geresh, dots or hyphens, for matching. */
export function normalizeHeader(text: string): string {
  return text.replace(/[\s"'״׳.\-_:()]/g, '');
}

const KNOWN = new Map<string, Field>([
  ...FIELDS.map((field) => [normalizeHeader(HEADERS[field]), field] as const),
  ...Object.entries(SYNONYMS),
]);

/** For each column of the file, the field it fills, or null when it stays only in `raw`. */
export function autoMapping(headers: readonly string[]): (Field | null)[] {
  const used = new Set<Field>();
  return headers.map((header) => {
    const field = KNOWN.get(normalizeHeader(header)) ?? null;
    if (!field || used.has(field)) return null;
    used.add(field);
    return field;
  });
}

/** True when every template column is found, so the mapping step can be skipped. */
export function isTemplate(headers: readonly string[]): boolean {
  const names = new Set(headers.map(normalizeHeader));
  return FIELDS.every((field) => names.has(normalizeHeader(HEADERS[field])));
}
