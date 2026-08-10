/**
 * TASKS H.3 / C.19 — the mortgage is VISIBLE in the fixed-cost list, at its full
 * monthly amount, exactly once.
 *
 * The owner has asked "where is mortgage?" four times. Every prior answer moved
 * the FIGURE (C.24 unions it at its full rate; C.25 keeps it out of the spending
 * totals in every month) and none of them put a line on a page, because the
 * union contributed a bare number while C.24's exactness invariant removed the
 * merchant's rows from the category rollup — the only half that produced lines.
 * A total no list can account for is what he was looking at.
 *
 * This locks the page, not the engine: `fixed-list-accounts-for-total.test.ts`
 * proves the arithmetic and the refusals, and a green engine has twice now
 * coexisted with a surface that never rendered it (`a-fix-on-the-reported-
 * surface-is-not-a-fix-on-the-pattern`). So the assertions below read the
 * RENDERED figures out of the DOM and add them up — the reconciliation claim has
 * to survive the round trip through the page or it is not a claim.
 *
 * Throwaway signup users, never the shared demo row (the shared-demo lesson).
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** The e2e server pins `DEMO_TODAY=2026-06-10` for every user (see
 *  calendar-frozen.spec.ts, which asserts the same premise). The rollup window
 *  is therefore the three complete months March–May 2026. */
const TODAY = '2026-06-10';
const WINDOW_MONTHS = ['2026-03', '2026-04', '2026-05'];

/** The owner's real figures, from the C.24/C.0 production replay. */
const MORTGAGE_CENTS = 621_707;
const MORTGAGE_DESCRIPTOR = 'TRUIST MORTG OLB MTGPMT';
const GROCERIES_CENTS = 80_000;

function money(n: number): string {
  return `$${(n / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-fixedcomp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function openDb() {
  return new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
}

/**
 * The owner's shape: a checking account paying a MORTGAGE account every month,
 * plus ordinary groceries so the category rollup has mass of its own (which is
 * what selects the `category-designations` basis — the only one that can be
 * itemized to the penny).
 *
 * The mortgage outflow is TRANSFER-FLAGGED in two of the three window months and
 * not in the third, which is the timing luck C.24 was built for and the reason
 * the row used to appear and disappear month to month.
 */
function seedOwnerShape(email: string) {
  const db = openDb();
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const uid = user.id;
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-fc-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Truist', 'ins_12345', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-fc-pi-${stamp}`, uid, itemId, TODAY);

    const chkId = `e2e-fc-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '0977', 1500000, 'USD')`,
    ).run(chkId, uid, `ref-fc-chk-${stamp}`, itemId);

    const mtgId = `e2e-fc-mtg-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, minimumPaymentCents, dueDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, 'Mortgage 1192', 'MORTGAGE', '1192', 41000000, 'USD', ?, 3)`,
    ).run(mtgId, uid, `ref-fc-mtg-${stamp}`, itemId, MORTGAGE_CENTS);

    const insert = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, 0)`,
    );
    // Income, so the plan has a pattern to allocate against.
    WINDOW_MONTHS.forEach((m, i) => {
      insert.run(`e2e-fc-inc-${stamp}-${i}`, chkId, `${m}-01`, 1_500_000, 'ACME PAYROLL DIRECT DEP', 'paycheck', 0);
    });
    // The mortgage: paid from checking, landing on the mortgage account 1 day
    // later so the ±3-day pair rule sees it. Flagged in March and April, not May.
    WINDOW_MONTHS.forEach((m, i) => {
      insert.run(
        `e2e-fc-mtgout-${stamp}-${i}`,
        chkId,
        `${m}-03`,
        -MORTGAGE_CENTS,
        MORTGAGE_DESCRIPTOR,
        'rent',
        i < 2 ? 1 : 0,
      );
      insert.run(
        `e2e-fc-mtgin-${stamp}-${i}`,
        mtgId,
        `${m}-04`,
        MORTGAGE_CENTS,
        MORTGAGE_DESCRIPTOR,
        null,
        0,
      );
    });
    // Ordinary fixed-category spend, so the rollup carries its own mass.
    WINDOW_MONTHS.forEach((m, i) => {
      insert.run(`e2e-fc-gro-${stamp}-${i}`, chkId, `${m}-11`, -GROCERIES_CENTS, 'PUBLIX #128', 'groceries', 0);
    });

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
  } finally {
    db.close();
  }
}

test('H.3: the mortgage is a line in the fixed-cost list, at its full monthly amount, exactly once', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedOwnerShape(email);

  await page.goto('/spending-plan');
  const panel = page.getByTestId('fixed-composition');
  await expect(panel).toBeVisible();

  // THE OWNER'S QUESTION, ASSERTED DIRECTLY: the mortgage is on the page, once.
  const mortgageRows = panel
    .getByTestId('fixed-composition-row')
    .filter({ hasText: new RegExp(MORTGAGE_DESCRIPTOR, 'i') });
  await expect(mortgageRows).toHaveCount(1);
  // At its FULL monthly amount — not the ÷3 fragment the rollup used to print.
  await expect(mortgageRows.getByTestId('fixed-composition-amount')).toHaveText(
    money(MORTGAGE_CENTS),
  );
  // Named as what it is, so it is not mistaken for a category total.
  await expect(mortgageRows.getByTestId('fixed-composition-bill-chip')).toHaveText(/loan payment/i);

  // The groceries category is listed too — the list is the WHOLE composition,
  // not a special case bolted on for the mortgage.
  await expect(
    panel.getByTestId('fixed-composition-row').filter({ hasText: /Groceries/i }),
  ).toHaveCount(1);
});

test('H.3: the rendered lines add up to the rendered total, and the page says so', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedOwnerShape(email);

  await page.goto('/spending-plan');
  const panel = page.getByTestId('fixed-composition');
  await expect(panel).toBeVisible();

  // Read the figures OFF THE PAGE and add them up here. If a future edit lets
  // the view render a subset of the lines, or the engine's total drifts from
  // what it itemized, this fails — which the engine test alone cannot catch.
  const rendered = await panel.getByTestId('fixed-composition-amount').allInnerTexts();
  expect(rendered.length).toBeGreaterThan(1);
  const toCents = (s: string) => Math.round(parseFloat(s.replace(/[$,]/g, '')) * 100);
  const sum = rendered.reduce((acc, s) => acc + toCents(s), 0);

  const totalText = await panel.getByTestId('fixed-composition-total').innerText();
  expect(sum).toBe(toCents(totalText));

  // And the certification is the reconciled one, not the hedge.
  await expect(panel.getByTestId('fixed-composition-reconciled')).toBeVisible();
  await expect(panel.getByTestId('fixed-composition-partial')).toHaveCount(0);
});

/**
 * TASKS H.4 / C.23 — a DECLARED reserve is a line in the same list, at cost/12,
 * and the total still accounts for every line.
 *
 * The owner: *"Fixed expense list must include mortgage and various savings for
 * longer term expenditures (yearly membership dues, home repair, etc…)"*, and
 * *"The way I personally categorize yearly membership dues is I divide by 12 and
 * put that cash aside."*
 *
 * Driven through the real form rather than a seeded row, because the division is
 * the feature: the reader types the WHOLE cost and the app produces the monthly
 * share. Seeding the Goal row directly would test the engine a unit test already
 * covers and would skip the one thing only a browser can check — that the
 * cadence the reader chose is the cadence that gets stored.
 */
test('H.4: a declared yearly reserve is listed at a twelfth, beside the mortgage, inside the total', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedOwnerShape(email);

  await page.goto('/spending-plan');
  const before = await page
    .getByTestId('fixed-composition')
    .getByTestId('fixed-composition-total')
    .innerText();

  const form = page.getByTestId('reserve-form');
  await expect(form).toBeVisible();
  await form.getByPlaceholder('Home repair').fill('Gym dues');
  await form.getByPlaceholder('1200').fill('1200');
  await form.getByTestId('reserve-cadence').selectOption('ANNUAL');
  await form.getByTestId('reserve-create').click();

  const panel = page.getByTestId('fixed-composition');
  const reserveRow = panel.getByTestId('fixed-composition-row').filter({ hasText: /Gym dues/i });
  await expect(reserveRow).toHaveCount(1, { timeout: 20_000 });
  // $1,200.00 a year, listed at $100.00 — the owner's own arithmetic, done for him.
  await expect(reserveRow.getByTestId('fixed-composition-amount')).toHaveText(money(10_000));
  // Marked as a declaration, so it is not mistaken for a detected charge.
  await expect(reserveRow.getByTestId('fixed-composition-reserve-chip')).toHaveText(/reserve/i);
  // And it says WHY $100 is not the number on any statement.
  await expect(reserveRow.getByTestId('fixed-composition-basis')).toHaveText(
    /a twelfth of the yearly cost/i,
  );

  // The mortgage is still there — a reserve joins the list, it does not replace it.
  await expect(
    panel.getByTestId('fixed-composition-row').filter({ hasText: new RegExp(MORTGAGE_DESCRIPTOR, 'i') }),
  ).toHaveCount(1);

  // The total moved by exactly the monthly share, and the rendered lines still
  // add up to the rendered total.
  const toCents = (s: string) => Math.round(parseFloat(s.replace(/[$,]/g, '')) * 100);
  const totalText = await panel.getByTestId('fixed-composition-total').innerText();
  expect(toCents(totalText) - toCents(before)).toBe(10_000);
  const rendered = await panel.getByTestId('fixed-composition-amount').allInnerTexts();
  expect(rendered.reduce((acc, s) => acc + toCents(s), 0)).toBe(toCents(totalText));
  await expect(panel.getByTestId('fixed-composition-reconciled')).toBeVisible();

  // The declaration is editable where it was made: one row, with its whole cost
  // stated in the reader's own terms.
  const editorRow = page.getByTestId('reserves-section').getByTestId('reserve-row');
  await expect(editorRow).toHaveCount(1);
  await expect(editorRow.getByTestId('reserve-row-basis')).toHaveText(/\$1,200\.00 a year/);
  await expect(editorRow.getByTestId('reserve-row-monthly')).toHaveText('$100.00/mo');
});
