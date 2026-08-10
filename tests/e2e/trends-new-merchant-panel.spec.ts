/**
 * O.18e — the /trends "New this month" row expands into a merchant-scope
 * breakdown: the exact rows the card's figure summed (carried out of the same
 * engine pass — DECISIONS #439), with a basis that states the window
 * explicitly: this in-progress figure stops at the as-of date, while the
 * movers beside it compare complete months.
 *
 * Runs on a THROWAWAY user (the shared demo is single-writer SQLite; a seeded
 * future-dated row belongs to nobody else's assertions). ALPHA CAFE gets five
 * June rows: two settled purchases, one settled refund, one pending purchase,
 * one FUTURE-dated purchase (6/15 > the pinned DEMO_TODAY 2026-06-10) →
 * figure $70.00, 4 rows, $40.00 disclosed as not-counted-yet.
 *
 * Golden sentences, not fragments: a figure swapped into the wrong slot of the
 * basis passes every fragment assertion (the W.10a lesson).
 */
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** e2e server pins DEMO_TODAY=2026-06-10 → the merchant figure stops there. */
const JUNE = '2026-06';

/** ALPHA CAFE's June rows, mixed order on purpose (the panel sorts oldest-first):
 *  settled 6/01 −$30, refund 6/02 +$5, settled 6/03 −$20, pending 6/05 −$25,
 *  future-dated 6/15 −$40. Figure = 30 + 20 + 25 − 5 = $70.00. */
const ALPHA_ROWS: ReadonlyArray<readonly [string, number, 'POSTED' | 'PENDING']> = [
  [`${JUNE}-03`, -2000, 'POSTED'],
  [`${JUNE}-15`, -4000, 'POSTED'], // dated after DEMO_TODAY — disclosed, not counted
  [`${JUNE}-01`, -3000, 'POSTED'],
  [`${JUNE}-05`, -2500, 'PENDING'],
  [`${JUNE}-02`, 500, 'POSTED'], // a refund — settles to a −$5.00 row
];

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-nm-panel-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedMerchantData(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedMerchantData: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-nmp-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-chk-${stamp}`);

    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, 'dining', ?, 0, 0)`,
    );
    ALPHA_ROWS.forEach(([date, cents, status], i) => {
      txn.run(`e2e-nmp-${i}-${stamp}`, checkingId, date, cents, 'ALPHA CAFE', status);
    });
  } finally {
    db.close();
  }
}

test('trends: a new-merchant row expands into its own rows with a through-date basis', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedMerchantData(email);

  await page.goto('/trends');
  await expect(page.getByTestId('trends-new-merchants')).toBeVisible();

  // The row's figure is the sum of its rows, printed once on the card.
  // `exact` matters (the reconciled sentence below also contains "$70.00"), and
  // `visible` matters MORE: the panel's Total span is mounted-but-hidden from
  // page load, so an unfiltered match resolves to TWO "$70.00" spans. The
  // visible one pre-expansion is the card figure, by construction.
  const cardAmount = page
    .getByTestId('new-merchant-row')
    .filter({ hasText: 'ALPHA CAFE' })
    .getByText('$70.00', { exact: true })
    .filter({ visible: true });
  await expect(cardAmount).toBeVisible();

  // Collapsed: the toggle names what it opens (toContainText — the control
  // carries a chevron glyph beside the words). Testids carry the NORMALIZED
  // merchant name ('Alpha Cafe' — the raw seed descriptor is 'ALPHA CAFE'),
  // because `id: n.merchant` is the engine's canonical display name.
  const toggle = page.getByTestId('new-merchant-breakdown-toggle-Alpha Cafe');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('Show 4 transactions');

  // Expand: the panel mounts the carried rows, oldest first, signed as the
  // register sees them (the refund reads −$5.00, the pending charge is marked).
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByTestId('new-merchant-breakdown-panel-Alpha Cafe');
  await expect(panel).toBeVisible();
  const rows = panel.getByTestId('new-merchant-breakdown-rows-Alpha Cafe').locator('li');
  await expect(rows).toHaveCount(4);
  await expect(panel.getByTestId('new-merchant-breakdown-row-amount')).toHaveText([
    '$30.00',
    '-$5.00',
    '$20.00',
    '$25.00',
  ]);
  await expect(panel.getByText('(pending)')).toBeVisible();

  // The figure reconciles to the penny — the carry-out invariant, stated.
  await expect(panel.getByTestId('new-merchant-breakdown-sum-Alpha Cafe')).toHaveText('$70.00');
  await expect(panel.getByTestId('new-merchant-breakdown-reconciled-Alpha Cafe')).toHaveText(
    'These 4 rows add up to exactly $70.00 — matched to the penny.',
  );

  // The THIRD basis, stated: the figure stops at the as-of date, and the
  // future-dated $40.00 is disclosed as not counted — a complete-sounding list
  // that omitted it would be worse than a shorter one.
  await expect(panel.getByText(/The \$70\.00 above is this merchant's spending in Jun '26 through Wed, Jun 10, 2026\./)).toBeVisible();
  await expect(panel.getByText(/\$40\.00 here is dated after today and isn't counted yet — this figure covers spending through today\./)).toBeVisible();
  await expect(
    panel.getByText(
      'These are the rows the figure counts. Pending charges are included; income, transfers ' +
        'between your own accounts, the container row left by a split, and anything you marked ' +
        'as not your spending are left out.',
    ),
  ).toBeVisible();

  // Collapse and re-expand: the round-trip works, the panel stays honest.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // WCAG 2.1 AA on the expanded panel (toggle aria-expanded/aria-controls,
  // region role, link contrast — the mover panel's own gate).
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
});
