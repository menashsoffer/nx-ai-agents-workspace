import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../support/accounts.ts';
import { sql } from '../support/db.ts';

const SUPPLIER = 'עמותת דמה לייעוץ';

async function newRequest(staff: Page, subject: string): Promise<void> {
  await staff.goto('/#/catalog');
  await staff.getByRole('link', { name: SUPPLIER }).first().click();
  await staff.getByRole('button', { name: 'הוספה לבקשת התקשרות' }).click();
  await staff.goto('/#/engagement');
  await staff.getByRole('button', { name: 'המשך' }).click();
  const details = staff.getByRole('form', { name: 'פרטי הבקשה' });
  await details.getByLabel('נושא').fill(subject);
  await details.getByLabel('אומדן בש״ח').fill('50000');
  await details.getByLabel('יחידה').selectOption({ label: 'אגף בדיקות א' });
  await details.getByRole('button', { name: 'בדיקת מסלול ושמירה ביחידה' }).click();
  await expect(staff.getByRole('region', { name: 'תוצאת בדיקת המסלול' })).toBeVisible();
}

async function approachInArea(staff: Page): Promise<void> {
  await staff.getByRole('button', { name: 'רישום פנייה לספקים' }).click();
  const dialog = staff.getByRole('dialog', { name: 'רישום פנייה לספקים' });
  await dialog.getByLabel('איך פניתם').selectOption({ label: 'האזור האישי' });
  await dialog.getByRole('button', { name: 'רישום הפנייה' }).click();
  await expect(dialog).toBeHidden();
}

/** Moves the deadline into the past, as if a week went by, so the offers open. */
function deadlinePassed(subject: string): void {
  sql(`update public.supplier_approaches a set approached_on = current_date - 10,
    respond_by = current_date - 1 from public.engagement_requests r
    where r.id = a.request_id and r.subject = '${subject}'`);
}

/** Stage C gate (25.11): after the deadline staff see the amount and choose the winner. */
async function chooseWinner(staff: Page, subject: string): Promise<void> {
  deadlinePassed(subject);
  await staff.reload();
  await staff.getByRole('button', { name: `פניות ותשובות: ${subject}` }).click();
  const answers = staff.getByRole('dialog', { name: `פניות ותשובות: ${subject}` });
  await expect(answers.getByRole('row', { name: new RegExp(SUPPLIER) })).toContainText('42,000');
  await answers.getByRole('button', { name: `בחירת ${SUPPLIER} כזוכה` }).click();
  const form = answers.getByRole('form', { name: `בחירת ${SUPPLIER} כזוכה` });
  await form.getByLabel(/נימוק/).fill('ההצעה היחידה שהוגשה');
  await form.getByRole('button', { name: 'בחירה כזוכה' }).click();
  await expect(answers.getByText(`${SUPPLIER} נבחר כזוכה, והבקשה נסגרה.`)).toBeVisible();
}

async function seesResult(supplier: Page, subject: string): Promise<void> {
  await supplier.reload();
  const closed = supplier.getByRole('region', { name: 'נסגרו' });
  await expect(closed.getByRole('listitem').filter({ hasText: subject })).toContainText(
    'ההצעה שלכם נבחרה',
  );
}

test('a request goes from opening to a winner, and the supplier sees it was chosen', async ({
  browser,
}) => {
  const subject = `ליווי ארגוני ${String(Date.now()).slice(-6)}`;
  const staff = await browser.newPage();
  await signIn(staff, 'editor');
  await newRequest(staff, subject);
  await approachInArea(staff);

  const supplier = await browser.newPage();
  await signIn(supplier, 'supplier');
  await supplier.goto('/#/supplier-area');
  const approaches = supplier.getByRole('region', { name: 'פניות' });
  await expect(approaches.getByText(subject, { exact: true })).toBeVisible();
  const item = approaches.getByRole('listitem').filter({ hasText: subject });
  await item.getByRole('button', { name: 'הגשת הצעה' }).click();
  const offer = supplier.getByRole('form', { name: `הגשת הצעה: ${subject}` });
  await offer.getByLabel('סכום ההצעה בש״ח').fill('42000');
  await offer.getByLabel('מע״מ').selectOption({ label: 'כולל מע״מ' });
  await offer.locator('input[type=file]').setInputFiles({
    name: 'offer.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
  });
  await offer.getByRole('button', { name: 'שליחת ההצעה' }).click();
  const answered = approaches.getByRole('region', { name: 'עניתם' });
  await expect(answered.getByRole('listitem').filter({ hasText: subject })).toContainText(
    'הגשתם הצעה',
  );

  await staff.goto('/#/engagement');
  await staff.getByRole('button', { name: `פניות ותשובות: ${subject}` }).click();
  const answers = staff.getByRole('dialog', { name: `פניות ותשובות: ${subject}` });
  await expect(answers.getByRole('row', { name: new RegExp(SUPPLIER) })).toContainText('הגיש הצעה');
  // The amount stays sealed until the deadline (supplier portal spec).
  await expect(answers).not.toContainText('42,000');
  await chooseWinner(staff, subject);
  await seesResult(supplier, subject);
});
