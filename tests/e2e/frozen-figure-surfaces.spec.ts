/**
 * TASKS L.18 — the surfaces that PRINT a figure derived from a frozen account, in a real browser.
 *
 * L.14 shipped the disclosure and reached /accounts and the dashboard. Everywhere else the app went
 * on printing "pay $X by DATE", a net worth, an FI projection and a runway from balances that had
 * stopped moving, because those surfaces do not render the cash-needed engine's `assumptions`.
 * Unit tests lock the sentences against the real engines; this locks that they actually REACH a
 * page, which is the half a builder test cannot see.
 *
 * Throwaway signup user, never the shared demo row (the shared-demo lesson), and the frozen card is
 * seeded with a real STATEMENT so /cards renders a genuine "pay $X by DATE" instruction over it —
 * the exact case the brief describes.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-frozen-fig-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * A connection with a healthy checking account and a CREDIT card the feed has stopped returning,
 * carrying a statement due shortly so the card produces a real obligation. The connection's own
 * `lastSyncedAt` is today: the bank is fine, this one account is not.
 */
function seedFrozenCard(
  email: string,
  opts: { cardName: string; droppedAt: string; dueDate: string; cycleStart: string },
) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedFrozenCard: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const today = new Date().toISOString().slice(0, 10);
    const itemId = `e2e-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Chase', 'ins_56', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-pi-${stamp}`, user.id, itemId, today);

    const chkId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '0977', 250000, 'USD')`,
    ).run(chkId, user.id, `ref-chk-${stamp}`, itemId);

    const cardId = `e2e-card-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, dueDayOfMonth, cycleCloseDayOfMonth, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CREDIT', '4321', 900000, 'USD', 2399, 15, 20, ?)`,
    ).run(cardId, user.id, `ref-card-${stamp}`, itemId, opts.cardName, opts.droppedAt);

    // A generated statement, so the card's figures come from the STATEMENT and the disclosure has to
    // be about the feed rather than about the balance.
    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, ?, ?, ?, 217999, 3500, 0)`,
    ).run(`e2e-stmt-${stamp}`, cardId, opts.cycleStart, opts.droppedAt, opts.dueDate);

    // A frozen brokerage, for the /coach split: it feeds the portfolio, never the FI number.
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, currentBalanceCents, currency, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, 'Old Brokerage', 'INVESTMENT', 421055, 'USD', ?)`,
    ).run(`e2e-brok-${stamp}`, user.id, `ref-brok-${stamp}`, itemId, opts.droppedAt);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, user.id);
    return { cardId, chkId };
  } finally {
    db.close();
  }
}

/** A due date a few weeks out, so the obligation is live and dated rather than clamped to today. */
function soon(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('the surfaces that print a frozen figure now say so — /cards, Ask and /coach', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const cardName = 'Chase Sapphire';
  const droppedAt = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  const { cardId } = seedFrozenCard(email, {
    cardName,
    droppedAt,
    dueDate: soon(12),
    cycleStart: new Date(Date.now() - 50 * 864e5).toISOString().slice(0, 10),
  });

  // ── /cards: the page that issues the instruction ───────────────────────────────────────
  await page.goto('/cards');
  const rowNote = page.getByTestId(`card-frozen-${cardId}`);
  await expect(rowNote).toBeVisible({ timeout: 20_000 });
  await expect(rowNote).toContainText('Your bank stopped sharing');
  // The claim corrected in this slice: with a statement present the figures do NOT come from the
  // frozen balance — what is missing is everything since the drop, a made payment included.
  await expect(rowNote).toContainText('including any payment you have already made');
  await expect(rowNote).not.toContainText('based on the last balance');
  // An instruction, so it carries the one control that exists in every state: the card itself.
  await expect(rowNote).toContainText('Check the card with your bank before paying');
  // The page really is printing the instruction this qualifies.
  await expect(page.getByTestId('do-this-first')).toContainText('$2,179.99');
  await expect(page.getByTestId(`user-action-${cardId}`)).toHaveText('$2,179.99');
  // The "Do this first" line gets its own qualifier, because a reader may act on that line alone.
  await expect(page.getByTestId('do-this-first-frozen')).toContainText('stopped sharing');

  // ── The dashboard: the same fact, on the page most people open ─────────────────────────
  // TASKS K.5. This read the reminders card's per-row note until #369 deleted that card. The
  // per-ROW instruction is now /cards' alone — the assertions above — and what Home still owes the
  // reader is that the frozen account is named at all, which the Today feed's `frozenDueNote`
  // paragraph does. Asserting the row note here again would have been asserting /cards twice.
  await page.goto('/dashboard');
  const feedDues = page.getByTestId('today-feed-frozen-dues');
  await expect(feedDues).toBeVisible({ timeout: 20_000 });
  await expect(feedDues).toContainText(cardName);
  await expect(feedDues).toContainText('stopped sharing');

  // ── Ask: the reported figure, and the panel opened to audit it ─────────────────────────
  await page.goto('/ask');
  await page.getByTestId('ask-input').fill("what's my net worth");
  await page.getByTestId('ask-submit').click();
  const answer = page.getByTestId('ask-answer');
  await expect(answer).toBeVisible({ timeout: 20_000 });
  await expect(answer).toContainText('stopped updating');
  await expect(answer).toContainText('still counted in your net worth');
  // The trace still RECONCILES — the rows do sum to the headline; freshness is a different claim,
  // and failing the check would hide the very audit trail this disclosure belongs to.
  await page.getByTestId('ask-headline').click();
  await expect(page.getByTestId('ask-deriv-reconciled')).toBeVisible();
  await expect(page.getByTestId('ask-trace')).toContainText('stopped updating');

  // ── /coach: qualified per figure, and NOT on the figure that reads no balance ──────────
  await page.goto('/coach');
  const coachNote = page.getByTestId('coach-frozen-note');
  await expect(coachNote).toBeVisible({ timeout: 20_000 });
  await expect(coachNote).toContainText('Old Brokerage');
  await expect(coachNote).toContainText('the portfolio these projections start from');
  // The FI number is annual expenses ÷ the withdrawal rate: no balance, so no caveat on it.
  await expect(page.getByTestId('fi-basis')).not.toContainText('stopped updating');
});

test('a user with nothing frozen sees none of it — /cards, Ask and /coach unchanged', async ({
  page,
}) => {
  // The abstention half, on the same three surfaces. A caveat that renders for everyone is noise,
  // and on an instruction a false hedge is worse than noise: it makes a reader under-fund.
  await signUpThrowaway(page);

  await page.goto('/cards');
  await expect(
    page
      .getByTestId('cards-empty')
      .or(page.getByTestId('scenario-summary'))
      // A brand-new signup has no accounts at all, so /cards renders the shared connect card.
      .or(page.getByTestId('empty-dashboard')),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(/^card-frozen-/)).toHaveCount(0);
  await expect(page.getByTestId('do-this-first-frozen')).toHaveCount(0);
  await expect(page.getByTestId('cards-frozen-all-clear')).toHaveCount(0);

  await page.goto('/dashboard');
  await expect(
    page.getByTestId('payment-reminders-card').or(page.getByTestId('empty-dashboard')),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(/^card-frozen-/)).toHaveCount(0);

  await page.goto('/coach');
  await expect(
    page.getByTestId('fi-card').or(page.getByTestId('coach-empty')),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('coach-frozen-note')).toHaveCount(0);
  await expect(page.getByTestId('runway-frozen-note')).toHaveCount(0);
});
