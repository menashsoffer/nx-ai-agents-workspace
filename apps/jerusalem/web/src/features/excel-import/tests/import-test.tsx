import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as rpc from '../../../data/rpc.ts';
import { ImportPage, loader } from '../import-page.tsx';
import type { ImportContext } from '../api/import.ts';
import { FIELDS, HEADERS } from '../model/columns.ts';
import { templateWorkbook } from '../model/template.ts';

const CONTEXT: ImportContext = {
  registries: [{ id: 'r1', name: 'מאגר הנדסה', status: 'active' }],
  versions: [{ id: 'v1', registry_id: 'r1', valid_from: '2026-01-01', created_at: '2026-01-01' }],
  drafts: [
    {
      id: 'old',
      status: 'in_review',
      row_count: 2,
      created_at: '2026-11-20T08:00:00Z',
      registry_id: null,
    },
  ],
};
const HEADER = FIELDS.map((f) => HEADERS[f]).join(',');
const CSV = `${HEADER}\nאבי הנדסה,חברה,ח.פ.,012345678,תכנון,02-1234567,,,,,\nספק חדש,,,,,,a@b.co,,,,\n`;
const IMPORT_ROWS = [
  {
    id: 11,
    row_number: 2,
    raw: {},
    edited: { name: 'אבי הנדסה' },
    status: 'promoted',
    decision: 'link',
    target_supplier_id: 's1',
    error: null,
    reviewer_note: null,
  },
  {
    id: 12,
    row_number: 3,
    raw: {},
    edited: { name: 'ספק חדש' },
    status: 'rejected',
    decision: 'hold',
    target_supplier_id: null,
    error: null,
    reviewer_note: 'כפול',
  },
];

function show(context = CONTEXT) {
  const router = createMemoryRouter(
    [{ id: 'import', path: '/', Component: ImportPage, loader: () => context }],
    { hydrationData: { loaderData: { import: context } } },
  );
  render(<RouterProvider router={router} />);
}

function answer(handler: (name: string, args: unknown) => unknown) {
  return vi
    .spyOn(rpc, 'rpc')
    .mockImplementation((name, args, schema) => Promise.resolve(schema.parse(handler(name, args))));
}

function tables(byTable: Record<string, unknown[]>) {
  return vi
    .spyOn(rpc, 'rows')
    .mockImplementation((table, _filters, schema) =>
      Promise.resolve(schema.parse(byTable[table] ?? [])),
    );
}

async function openCsv(text = CSV) {
  const input = screen.getByLabelText<HTMLInputElement>(/קובץ ספקים/);
  await userEvent.upload(input, new File([text], 'ספקים.csv', { type: 'text/csv' }));
  await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
}

beforeEach(() => {
  vi.spyOn(rpc, 'freshToken').mockResolvedValue('token');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});
afterEach(cleanup);

describe('excel import page', () => {
  it('loads registries, versions and open drafts for an admin', async () => {
    vi.spyOn(rpc, 'requireRoles').mockResolvedValue({} as rpc.Identity);
    const read = tables({ registries: CONTEXT.registries });
    expect((await loader()).registries).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('reads a template file, saves a draft, compares, and imports after approval', async () => {
    const calls: string[] = [];
    answer((name) => {
      calls.push(name);
      if (name === 'stage_excel_import') {
        return {
          batch_id: 'b1',
          duplicate: false,
          rows: [
            { row_id: 11, candidates: [{ id: 's1', name: 'אבי הנדסה', match_rank: 1 }] },
            { row_id: 12, candidates: [] },
          ],
        };
      }
      if (name === 'decide_import_rows') return 2;
      return { promoted: 1, failed: 0, pending: 0 };
    });
    tables({
      suppliers: [
        { id: 's1', display_name: 'אבי הנדסה בע"מ', entity_kind: 'company', website: null },
      ],
      supplier_contacts: [
        { supplier_id: 's1', kind: 'phone', value: '02-7654321', status: 'current' },
      ],
      import_rows: IMPORT_ROWS,
    });
    show();
    await userEvent.selectOptions(screen.getByLabelText(/^מאגר/), 'r1');
    expect(screen.getByLabelText(/גרסת המאגר/)).toBeDefined();
    await openCsv();
    expect(await screen.findByText(/הותאמו מעצמן/)).toBeDefined();
    expect(screen.getByRole('table', { name: /חמש השורות/ })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'שמירת טיוטה' }));
    const first = await screen.findByRole('listitem', { name: 'שורה 2' });
    expect(within(first).getByRole('radio', { name: /שיוך לאבי הנדסה/ })).toHaveProperty(
      'checked',
      true,
    );
    expect(await within(first).findByText('02-7654321')).toBeDefined();
    expect(within(first).getAllByText(/יתווסף לצד הקיים/)).toHaveLength(2);
    const second = screen.getByRole('listitem', { name: 'שורה 3' });
    await userEvent.click(within(second).getByRole('radio', { name: 'דילוג' }));
    await userEvent.click(screen.getByRole('button', { name: 'אישור וקליטה' }));
    expect(await screen.findByText('בשורה 3 חסרה סיבת דילוג.')).toBeDefined();
    await userEvent.type(within(second).getByLabelText(/^סיבת הדילוג/), 'כפול');
    await userEvent.type(within(second).getByLabelText(/^טלפון/), '1');
    await userEvent.click(screen.getByRole('button', { name: 'אישור וקליטה' }));
    expect(await screen.findByText('נקלטו 1 שורות. 0 ממתינות.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'לכרטיס הספק' }).getAttribute('href')).toBe(
      '/supplier/s1',
    );
    expect(screen.getByText('כפול')).toBeDefined();
    expect(calls).toEqual(['stage_excel_import', 'decide_import_rows', 'apply_import_batch']);
  });

  it('asks for the name column in a file that is not the template, and shows file problems', async () => {
    show();
    await openCsv('שם\n');
    await userEvent.click(await screen.findByRole('button', { name: 'שמירת טיוטה' }));
    expect(await screen.findByText('בגיליון הזה אין שורות נתונים מתחת לכותרות.')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'קובץ אחר' }));
    await openCsv('עמודה,אחרת\nא,ב\n');
    await userEvent.click(await screen.findByRole('button', { name: 'שמירת טיוטה' }));
    expect(await screen.findByText(/צריך לבחור איזו עמודה/)).toBeDefined();
    await userEvent.selectOptions(screen.getByLabelText('עמודה'), 'name');
    expect(screen.getByLabelText('אחרת')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'קובץ אחר' }));
    await userEvent.selectOptions(screen.getByLabelText(/^מאגר/), 'new');
    await openCsv();
    expect(await screen.findByText('צריך לכתוב את שם המאגר החדש.')).toBeDefined();
  });

  it('reopens a saved draft and a file already staged, and explains a duplicate source', async () => {
    answer((name, args) => {
      const batch = (args as { batch: Record<string, unknown> }).batch;
      if (name === 'stage_excel_import' && !batch.batch_id)
        return { batch_id: null, duplicate: true };
      return { batch_id: 'old', duplicate: true, rows: [{ row_id: 11, candidates: [] }] };
    });
    tables({ import_rows: [{ ...IMPORT_ROWS[0], status: 'pending', decision: 'new' }] });
    show();
    await userEvent.click(screen.getByRole('button', { name: 'המשך הטיוטה' }));
    expect(await screen.findByRole('listitem', { name: 'שורה 2' })).toBeDefined();
    cleanup();
    vi.mocked(fetch).mockResolvedValue(new Response('{"error":"Duplicate"}', { status: 400 }));
    show();
    await openCsv();
    await userEvent.click(await screen.findByRole('button', { name: 'שמירת טיוטה' }));
    expect(await screen.findByText(/כבר נשמר כמסמך מקור/)).toBeDefined();
  });

  it('lets the admin pick another sheet and refuses more than 5,000 rows', async () => {
    show();
    const input = screen.getByLabelText<HTMLInputElement>(/קובץ ספקים/);
    await userEvent.upload(input, new File([templateWorkbook()], 'תבנית.xlsx'));
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
    await userEvent.selectOptions(await screen.findByLabelText('גיליון'), '1');
    expect(screen.getByLabelText('מה לכתוב')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'קובץ אחר' }));
    await openCsv(`שם ספק\n${'א\n'.repeat(5001)}`);
    await userEvent.click(await screen.findByRole('button', { name: 'שמירת טיוטה' }));
    expect(await screen.findByText(/יותר מ-5,000 שורות/)).toBeDefined();
  });

  it('shows why a source upload failed', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"message":"no"}', { status: 403 }));
    show();
    await openCsv();
    await userEvent.click(await screen.findByRole('button', { name: 'שמירת טיוטה' }));
    expect(await screen.findByRole('alert')).toBeDefined();
  });

  it('downloads the template', async () => {
    const create = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'הורדת תבנית' }));
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
    expect(create).toHaveBeenCalled();
  });
});
