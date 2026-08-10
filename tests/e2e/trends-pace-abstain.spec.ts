/**
 * C.1 (CALC_AUDIT 2026-08-02, P0-7) — the pace card must abstain, in words, on a
 * month nothing has been counted in.
 *
 * The engine used to abstain only when this month AND last month were both zero,
 * so a reader who opened the app before any row had landed was shown "$0.00
 * projected by month end" and, in green, a large "on pace for … less than last
 * month". The unit locks cover the engine; this covers the half a unit test
 * cannot see — that both surfaces actually render the abstention, and that the
 * dashboard card no longer answers with "Not enough activity yet to spot
 * trends" while the biggest-change row beneath it is naming a completed-month
 * fact. That contradiction is the reachable shape: the fix makes it common on
 * the first days of a month, so the sentence had to move with it.
 *
 * A throwaway signup user, never the shared demo row — the demo seeds 847
 * transactions and therefore cannot express "nothing this month".
 *
 * The e2e server pins `DEMO_TODAY=2026-06-10` for EVERY user (see the note in
 * `budgets-basis.spec.ts`), so the in-progress month is June 2026 and May is the
 * last completed month regardless of the wall clock.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** Last completed month relative to the pinned today — deliberately NOT June. */
const PRIOR_MONTH_DATE = '2026-05-14';
const PRIOR_MONTH_CENTS = -20000;
/** The shared sentence, authored once in `engine/trends/labels.ts`. */
const ABSTAIN = 'No spending counted yet this month';
/** The dashboard's pre-C.1 wording, false the moment a mover renders beside it. */
const OLD_COPY = 'Not enough activity yet';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-pace-abstain-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * A funding account with spending in the LAST COMPLETED month and none in the
 * in-progress one. The prior-month charge is what makes this fixture the hard
 * case: under the old guard it was the very value that unlocked the projection
 * (`$0.00 projected · $200.00 less than last month`), and it is what puts a
 * biggest-change row on the dashboard card beside the abstention.
 */
function seedPriorMonthOnly(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedPriorMonthOnly: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-chk-${stamp}`);

    // "Transaction" is a SQLite reserved word — it must be quoted.
    db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, 'BLUE BOTTLE COFFEE', 'dining', 'POSTED', 0, 0)`,
    ).run(`e2e-prior-${stamp}`, checkingId, PRIOR_MONTH_DATE, PRIOR_MONTH_CENTS);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(checkingId, user.id);
  } finally {
    db.close();
  }
}

test('a month with nothing counted gets an abstention in words, on both surfaces', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedPriorMonthOnly(email);

  // ── /trends ────────────────────────────────────────────────────────────────
  await page.goto('/trends');

  // The fixture's hard case, asserted first: this reader HAS history, so the
  // page is refusing to project rather than having nothing to say. Without this
  // the spec would pass just as well against an empty account.
  await expect(page.getByTestId('trends-movers')).toContainText('Dining');

  await expect(page.getByTestId('trends-pace-empty')).toContainText(ABSTAIN);
  await expect(page.getByTestId('trends-pace')).toHaveCount(0);
  // The projection itself must be gone, not merely re-worded.
  await expect(page.getByTestId('trends-pace-empty')).not.toContainText('projected by month end');

  // ── Dashboard ──────────────────────────────────────────────────────────────
  await page.goto('/dashboard');
  const card = page.getByTestId('dashboard-spending-insights');
  await expect(card.getByTestId('dashboard-trends-pace-empty')).toContainText(ABSTAIN);
  await expect(card.getByTestId('dashboard-trends-pace-days')).toHaveCount(0);
  await expect(card).not.toContainText('on pace for');

  // The contradiction the copy change exists for: a completed-month change is
  // named on this very card, so "not enough activity yet" cannot be the answer.
  await expect(card.getByTestId('dashboard-trends-mover-window')).toBeVisible();
  await expect(card).not.toContainText(OLD_COPY);
});
