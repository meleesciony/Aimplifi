/**
 * Glass-Box (DECISIONS #178, Competitive-Gap Gap 4 §1): tap a headline number →
 * the rows it's made of, reconciled to the penny. The reconciliation here is
 * REAL: the test parses the rendered row amounts off the DOM, sums them, and
 * compares against the rendered headline — end to end, not a trusted flag.
 */
import { expect, test, type Page } from './helpers/test';
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { E2E_DB_URL } from '../setup/test-db';

/** "$5,412.33" / "− $1,234.56" / "-$0.50" → signed integer cents. */
function textToCents(s: string): number {
  const trimmed = s.trim();
  const negative = trimmed.startsWith('−') || trimmed.startsWith('-');
  const digits = trimmed.replace(/[^0-9]/g, '');
  return (negative ? -1 : 1) * Number(digits);
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('dashboard cash-needed: tapping the number opens rows that sum to it exactly', async ({ page }) => {
  await signIn(page);

  const amount = page.getByTestId('cash-needed-amount');
  const panel = page.getByTestId('glass-box-panel');

  // Closed by default; the trigger is a real disclosure button.
  await expect(panel).toBeHidden();
  await expect(amount).toHaveAttribute('aria-expanded', 'false');

  await amount.click();
  await expect(panel).toBeVisible();
  await expect(amount).toHaveAttribute('aria-expanded', 'true');

  // The felt promise: rows parsed off the DOM sum to the rendered headline.
  const rowTexts = await page.getByTestId('glass-box-row-amount').allTextContents();
  expect(rowTexts.length).toBeGreaterThan(0);
  const rowSum = rowTexts.reduce((acc, t) => acc + textToCents(t), 0);
  const headlineCents = textToCents((await amount.textContent()) ?? '');
  expect(rowSum).toBe(headlineCents); // seed: 271233 + 210000 + 60000 = 541233
  await expect(page.getByTestId('glass-box-sum')).toHaveText('$5,412.33');
  await expect(page.getByTestId('glass-box-reconciled')).toContainText('matched to the penny');
  await expect(page.getByTestId('glass-box-reconciled')).toContainText('nothing is invented');

  // Provenance rides along: the seed's autopay card explains itself in-row.
  await expect(panel).toContainText('Autopay handles this payment');
  // The seed's Store Card (no generated statement) is disclosed as excluded.
  await expect(panel).toContainText('next cycle');

  // The expanded panel is WCAG-AA clean (scoped to the card).
  const results = await new AxeBuilder({ page })
    .include('[data-testid="cash-needed-card"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // Toggles closed again.
  await amount.click();
  await expect(panel).toBeHidden();
  await expect(amount).toHaveAttribute('aria-expanded', 'false');
});

test('share snapshot is redacted and stays client-side', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);

  await page.getByTestId('cash-needed-amount').click();
  await expect(page.getByTestId('glass-box-panel')).toBeVisible();
  await expect(page.getByTestId('glass-box-share')).toBeVisible();

  // Live panel still shows real seed card names; the share TARGET must not.
  await expect(page.getByTestId('glass-box-panel')).toContainText(/Platinum|Sapphire|Freedom/i);
  const target = page.getByTestId('glass-box-share-target');
  await expect(target).toContainText('Card 1');
  await expect(target).toContainText('$5,412.33');
  await expect(target).not.toContainText(/Platinum|Sapphire|Freedom/i);
  await expect(target).toContainText('Nothing left this device');

  await page.getByTestId('glass-box-share').click();
  await expect(page.getByTestId('glass-box-share-status')).toContainText(/Copied|Saved/i);
});

test('spending plan: the breakdown lines sum to "Guilt-free to spend" exactly', async ({ page }) => {
  await signIn(page);
  await page.goto('/spending-plan');
  await expect(page.getByTestId('spending-plan-hero')).toBeVisible();

  const rowTexts = await page.getByTestId('plan-row-amount').allTextContents();
  // The SUM is the invariant; the count follows the identity. Three rows —
  // income − fixed − savings — since 2026-08-01 (owner: card payments settle
  // spend already counted, so they are not a guilt-free term; 9087d26 removed
  // the fourth row). The old ">= 4" here was a stale golden from the 4-row
  // model, invisible until this spec was next run because verify.sh skips
  // Playwright by default (`fencing-a-write-path-breaks-the-tests-that-drove-it`).
  expect(rowTexts.length).toBeGreaterThanOrEqual(3);
  const rowSum = rowTexts.reduce((acc, t) => acc + textToCents(t), 0);
  const totalCents = textToCents((await page.getByTestId('plan-total').textContent()) ?? '');
  expect(rowSum).toBe(totalCents);

  await expect(page.getByTestId('plan-reconciled')).toContainText('matched to the penny');
});

test('spending plan: every $0.00 line says WHICH zero it is (TASKS L.29)', async ({ page }) => {
  // GL.4 moved the demo's savings zero (the demo seed now carries two goals, so
  // its savings line is goal-derived at $350.00 — locked on /budgets by the
  // conscious-buckets spec). The
  // L.29 lock itself needs a world where a zero row BINDS by construction, so it
  // runs on a throwaway user with no goals and no savings target (the trends-caps
  // fixture idiom): one income month → pattern, no fixed rows → an honest $0.00
  // savings row with the unset label + control.
  const email = `e2e-glassbox-zero-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // One checking account + two complete months of filed paycheck income (the
  // conscious-buckets fixture idiom) so the plan pattern exists and the savings
  // row renders its honest unset-$0 state — no goals, no savings target.
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const checkingId = `e2e-gb-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-gb-chk-${stamp}`);
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    [['2026-04-05', 500_000], ['2026-05-05', 500_000]].forEach(([date, amount], i) => {
      txn.run(`e2e-gb-inc-${i}-${stamp}`, checkingId, date as string, amount as number, 'E2E PAYCHECK', 'paycheck');
    });
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(checkingId, user.id);
  } finally {
    db.close();
  }

  await page.goto('/spending-plan');
  await expect(page.getByTestId('spending-plan-hero')).toBeVisible({ timeout: 20000 });

  const rows = await page.getByTestId('plan-row').all();
  expect(rows.length).toBeGreaterThanOrEqual(3);
  let zeros = 0;
  for (const row of rows) {
    const amount = (await row.getByTestId('plan-row-amount').textContent()) ?? '';
    const label = (await row.getByTestId('plan-row-label').textContent()) ?? '';
    if (textToCents(amount) !== 0) continue;
    zeros += 1;
    // The whole point of the slice: rendered as bare "$0.00" a true zero and a
    // broken zero are the same pixel, which is how the L.26 defect survived four
    // sessions of the owner reading this panel.
    expect(label, `a $0.00 line printed no reason: "${label}"`).toMatch(/\(.+\)/);
  }
  // The lock may not quietly degrade into measuring nothing (the L.19 corollary:
  // assert the fixture's hard case is actually present).
  expect(zeros).toBeGreaterThanOrEqual(1);

  // The savings zero specifically: unset label + the /settings control that exists.
  const savings = page.getByTestId('plan-row').filter({ hasText: 'Planned savings' });
  await expect(savings.getByTestId('plan-row-label')).toContainText(
    'Planned savings (no monthly amount set)',
  );
  await expect(savings.getByTestId('plan-row-amount')).toHaveText(/\$0\.00/);
  await expect(savings.getByTestId('plan-row-action')).toHaveAttribute('href', '/settings');
});
