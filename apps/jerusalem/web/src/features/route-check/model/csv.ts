import type { PickedSupplier } from './engagement.ts';

// Loaded only when the user exports. UTF-8 with a BOM so Excel reads Hebrew correctly.
// Identifier numbers are never part of the export.

const HEADER = ['שם הספק', 'דוא״ל', 'טלפון', 'פנייה אחרונה', 'מצב'];

function cell(value: string): string {
  // A leading formula character would run in a spreadsheet; prefix it so it stays text.
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function shortlistCsv(suppliers: readonly PickedSupplier[]): string {
  const rows = suppliers.map((s) => [
    s.name,
    s.emails.join('; '),
    s.phones.join('; '),
    s.lastApproached ?? '',
    s.inactive ? 'לא פעיל' : 'פעיל',
  ]);
  return `\uFEFF${[HEADER, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function downloadCsv(suppliers: readonly PickedSupplier[], today: string): void {
  const blob = new Blob([shortlistCsv(suppliers)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `ספקים-לבקשה-${today}.csv`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
