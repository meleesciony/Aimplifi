/**
 * C.2 (CALC_AUDIT 2026-08-02, P1-1) — the pace projection counts the bills the
 * app already knows about, and says which ones.
 *
 * The unit locks cover the arithmetic. This covers the half they cannot see:
 * that a stored `ScheduledTransaction` row actually reaches the projection
 * through the server, and that both surfaces print the bill by name. The owner's
 * complaint was not that a number was off by a little — it was *"8971.25 makes
 * no sense since our mortgage is ~6200"*, a figure whose inputs were invisible,
 * so the naming is the fix as much as the arithmetic is.
 *
 * A throwaway signup user, never the shared demo row: the demo's scheduled rows
 * are hand-authored labels ("Rent — Peachtree Properties") that deliberately
 * match no merchant, so the demo cannot express this case at all — which the
 * unit suite pins separately.
 *
 * The e2e server pins `DEMO_TODAY=2026-06-10` for EVERY user (see the note in
 * `budgets-basis.spec.ts`), so the in-progress month is June 2026.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';

/** The servicer descriptor and the canonical name the normalizer gives it —
 *  read from the normalizer itself, because the whole design rests on the
 *  scheduled row's description being that exact value. */
const MORTGAGE_DESCRIPTOR = 'MR COOPER MTG PMT 8841';
const MORTGAGE_MERCHANT = normalizeMerchant(MORTGAGE_DESCRIPTOR).canonical;
const MORTGAGE_CENTS = -620000;

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-pace-bills-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * A mortgage charged in May (the history that admits the bill), a small June
 * coffee (so the pace has a rate to project and does not abstain under C.1), and
 * the stored bill row itself, dated next month exactly as the detector writes it
 * once June's payment is the one that has not happened yet.
 */
function seedMortgageBill(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedMortgageBill: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-chk-${stamp}`);

    // "Transaction" is a SQLite reserved word — it must be quoted.
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    // Unfiled, like the real thing: the merchant table has no mortgage pattern.
    txn.run(`e2e-mtg-${stamp}`, checkingId, '2026-05-01', MORTGAGE_CENTS, MORTGAGE_DESCRIPTOR, null);
    txn.run(`e2e-cof-${stamp}`, checkingId, '2026-06-02', -2000, 'BLUE BOTTLE COFFEE', 'dining');

    db.prepare(
      `INSERT INTO ScheduledTransaction (id, accountId, description, amountCents, nextDate, cadence, source)
       VALUES (?, ?, ?, ?, '2026-07-01', 'MONTHLY', 'recurring')`,
    ).run(`e2e-sched-${stamp}`, checkingId, MORTGAGE_MERCHANT, MORTGAGE_CENTS);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(checkingId, user.id);
  } finally {
    db.close();
  }
}

test('an unpaid bill is inside the projection and named on both surfaces', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedMortgageBill(email);

  // ── /trends ────────────────────────────────────────────────────────────────
  await page.goto('/trends');

  // The fixture's hard case, asserted before anything else: the bill row reached
  // the page. Without this the spec would pass just as well against an account
  // that has no bills, which is the way this lock would silently decay.
  const bills = page.getByTestId('trends-pace-bills');
  await expect(bills).toContainText(MORTGAGE_MERCHANT);
  await expect(bills).toContainText('$6,200.00 of bill still due');

  // $20.00 counted over the first 10 days used to project $60.00 for the whole
  // month, under a green "less than last month" beside a $6,200.00 mortgage that
  // was about to land. The figure now contains it.
  const pace = page.getByTestId('trends-pace');
  await expect(pace).toContainText('$6,260.00'); // 2000 + 620000 + 2000 × 20 / 10
  // The coverage clause states the admission rule POSITIVELY (C.2 critic P0/P1):
  // an enumeration of exclusions beside a money figure claims to be complete,
  // and it was not — /calendar renders refused rows as bills still due one click
  // away, off the same array this projection reads.
  await expect(pace).toContainText(
    'Only bills we can match to a merchant you have spent at are counted here',
  );

  // ── Dashboard ──────────────────────────────────────────────────────────────
  await page.goto('/dashboard');
  const card = page.getByTestId('dashboard-spending-insights');
  await expect(card.getByTestId('dashboard-trends-pace-bills')).toContainText(MORTGAGE_MERCHANT);
  await expect(card).toContainText('$6,260.00 projected');
  // The assumption sentence must describe the model the reader is looking at:
  // naming the bills it added, not just a daily rate that explains none of it.
  await expect(card.getByTestId('dashboard-trends-pace-assumption')).toContainText(
    'Adds $6,200.00 of bills still due',
  );
});
