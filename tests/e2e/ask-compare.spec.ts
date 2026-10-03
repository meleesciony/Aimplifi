/**
 * Ask — one month against another, on the accounts whose records cover both
 * (DECISIONS #781). Drives the real page on a signed-up account with two cards, one of
 * whose records stop in April, so every part a reader meets is exercised: the reading,
 * the figure, the account left out and why, the one-tap question, the figure changing
 * once it is answered, and the answer being kept.
 *
 * The server's "today" is pinned (DEMO_TODAY=2026-06-10), so May 2026 is the last
 * finished month.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

const PASSWORD = 'e2e-password-123';

async function ask(page: Page, question: string) {
  await page.getByTestId('ask-input').fill(question);
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-answer')).toBeVisible();
}

function seed(email: string) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const account = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, ?, 'CREDIT', ?, 0, 'USD')`,
    );
    account.run(`e2e-cmp-a-${stamp}`, user.id, `ref-a-${stamp}`, 'Everyday Card', '1111');
    account.run(`e2e-cmp-b-${stamp}`, user.id, `ref-b-${stamp}`, 'Old Card', '2222');
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    const rows: [string, string, number, string][] = [
      ['a', '2026-03-05', -10000, 'groceries'],
      ['a', '2026-04-05', -12000, 'groceries'],
      ['a', '2026-05-05', -15000, 'groceries'],
      ['a', '2026-06-02', -1000, 'groceries'], // a row after May: the record runs past May
      ['b', '2026-02-01', -3000, 'dining'],
      ['b', '2026-04-10', -4000, 'dining'], // Old Card's last transaction
    ];
    rows.forEach(([acct, date, cents, category], i) =>
      txn.run(`e2e-cmp-${i}-${stamp}`, `e2e-cmp-${acct}-${stamp}`, date, cents, `E2E CMP ${i}`, category),
    );
  } finally {
    db.close();
  }
}

test.describe('Ask: compare two months on the accounts whose records cover both', () => {
  test.describe.configure({ mode: 'serial' });

  test('the figure, the account left out, the question — and the figure once it is answered', async ({ page }) => {
    const email = `e2e-cmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
    await page.goto('/sign-in');
    await page.getByTestId('auth-toggle').click();
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
    seed(email);

    await page.goto('/ask');
    await ask(page, 'Compare spending in May 2026 to April 2026');
    const answer = page.getByTestId('ask-answer');
    // Everyday Card alone: May 150.00 against April 120.00 — +30.00, 25%. The headline says
    // whose figure it is: with Old Card left out it is not the reader's total.
    await expect(page.getByTestId('ask-headline')).toHaveText(
      'On the 1 account with complete records, you spent $150.00 in May 2026 — $30.00 more than in April 2026 ($120.00). That is 25% higher.',
    );
    await expect(answer).toContainText('Reading: All spending, May 2026 against April 2026, on the 1 account with complete records for both months.');
    // The account left out is named in the sentence with what it has on record and why —
    // not as a fact row, whose figure slot ran this reason off a 380px screen.
    await expect(answer).toContainText(
      'Left out of both months, because their records do not cover both: Old Card ($0.00 in May 2026, $40.00 in April 2026; nothing on record after Apr 10, 2026).',
    );
    await expect(page.getByTestId('ask-fact').filter({ hasText: 'Left out' })).toHaveCount(0);
    await expect(answer).toContainText('Everyday Card is kept by hand');

    // The question that would let it in.
    const question = page.getByTestId('ask-account-question');
    await expect(question).toHaveCount(1);
    await expect(question).toContainText('Is Apr 10, 2026 the last time Old Card was used?');
    // Nothing in the answer pushes the page sideways on a phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const answerBox = (await answer.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(answerBox.x + answerBox.width).toBeLessThanOrEqual(viewport.width);
    await question.getByTestId('ask-account-question-yes').click();

    // Answered: Old Card's May is a real zero, its April counts. April 160.00, May 150.00.
    await expect(page.getByTestId('ask-headline')).toHaveText(
      'You spent $150.00 in May 2026 — $10.00 less than in April 2026 ($160.00). That is 6% lower.',
    );
    await expect(page.getByTestId('ask-account-question')).toHaveCount(0);
    await expect(answer).toContainText('on all 2 accounts you spend from');
    // Focus lands on the new headline, not on <body>.
    await expect(page.getByTestId('ask-headline')).toBeFocused();
    // Two groups moved, so each is a row: its two months in the label, which wraps — never
    // clipped (critic cycle 1, F6: `truncate` hid the second amount at 380px).
    await expect(page.getByTestId('ask-fact')).toHaveCount(2);
    await expect(page.getByTestId('ask-fact').filter({ hasText: 'Groceries ($150.00 vs $120.00)' })).toContainText('+$30.00');
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="ask-fact"] span:first-child')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    );
    expect(clipped).toBe(0);

    // Kept: a fresh page, the same question, the same answer — not asked again.
    await page.reload();
    await ask(page, 'did I spend more in may than april');
    await expect(page.getByTestId('ask-headline')).toHaveText(
      'You spent $150.00 in May 2026 — $10.00 less than in April 2026 ($160.00). That is 6% lower.',
    );
    await expect(page.getByTestId('ask-account-question')).toHaveCount(0);
  });

  test('a question that went stale is not kept, and the answer as it stands replaces it — no raw error', async ({ page }) => {
    const email = `e2e-cmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
    await page.goto('/sign-in');
    await page.getByTestId('auth-toggle').click();
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
    seed(email);

    await page.goto('/ask');
    await ask(page, 'Compare spending in May 2026 to April 2026');
    await expect(page.getByTestId('ask-account-question')).toContainText('Is Apr 10, 2026 the last time Old Card was used?');

    // Meanwhile a later Old Card charge arrives: the question's edge date is no longer its edge.
    const db = new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
    try {
      const acct = db
        .prepare(`SELECT a.id FROM Account a JOIN User u ON u.id = a.userId WHERE u.email = ? AND a.name = 'Old Card'`)
        .get(email) as { id: string };
      db.prepare(
        `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
         VALUES (?, ?, '2026-05-20', -2500, 'E2E CMP LATE', 'dining', 'POSTED', 0, 0)`,
      ).run(`e2e-cmp-late-${Date.now()}`, acct.id);
    } finally {
      db.close();
    }

    await page.getByTestId('ask-account-question-yes').click();
    await expect(page.getByTestId('ask-account-question-notice')).toHaveText(
      'That account has changed since this was asked, so nothing was saved — here is the answer as it stands now.',
    );
    await expect(page.getByTestId('ask-account-question-error')).toHaveCount(0);
    await expect(page.getByText('Server Components render')).toHaveCount(0);
    // The answer as it stands: Old Card's record now stops May 20, and that is what is asked.
    await expect(page.getByTestId('ask-account-question')).toContainText('Is May 20, 2026 the last time Old Card was used?');
  });
});

test('a month answer offers the comparison as a button, and the button asks exactly that', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/ask');

  await ask(page, 'How much did I spend in May 2026?');
  const headline = (await page.getByTestId('ask-headline').textContent()) ?? '';
  const may = /\$[\d,]+\.\d{2}/.exec(headline)?.[0];
  expect(may, headline).toBeTruthy();

  const chip = page.getByTestId('ask-follow-up').filter({ hasText: 'Compare spending in May 2026 to April 2026' });
  await expect(chip).toHaveCount(1);
  await chip.click();
  // The demo's records cover both months on every account, so the comparison is on all of
  // them — and its May is the very figure the month answer printed.
  await expect(page.getByTestId('ask-headline')).toContainText(`You spent ${may} in May 2026`);
  await expect(page.getByTestId('ask-answer')).toContainText('you spend from');
  // The shared demo account is never asked a question it could not answer.
  await expect(page.getByTestId('ask-account-question')).toHaveCount(0);
});

test('a month still in progress is compared day for day with the month before, and says so', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/ask');
  // Demo "today" is Jun 10: June's first 9 days (through yesterday) against May's first 9.
  await ask(page, 'compare this month to last month');
  await expect(page.getByTestId('ask-headline')).toContainText('in the first 9 days of June 2026');
  await expect(page.getByTestId('ask-headline')).toContainText('in the first 9 days of May 2026');
  await expect(page.getByTestId('ask-answer')).toContainText(
    'June 2026 is not over, so this compares its first 9 days with the same days of May 2026. Charges from the last few days can still post.',
  );
});
