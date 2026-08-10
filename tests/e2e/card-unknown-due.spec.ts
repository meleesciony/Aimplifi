/**
 * Owner-reported 2026-07-23: the dashboard said "No card payments are due this
 * cycle" while real credit cards were linked and carrying balances, and /cards
 * listed nothing at all. A card with no generated statement and no cycle days is
 * unplaceable by the cash-needed engine, and the resulting EMPTY obligation set
 * was rendered as a positive money claim.
 *
 * This is the end-to-end lock: seed exactly that shape — a real signed-up user
 * with a checking account and a CREDIT account that has a balance but no
 * Statement row — and assert both surfaces tell the truth instead.
 *
 * A throwaway signup user, never the shared demo row: the demo seed ships 62
 * statements, so it cannot express "a card the bank never sent a statement for".
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-unknown-due-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * A funding checking account + a credit card with a balance and NO statement —
 * the exact shape a Plaid link produces when the issuer returns no liabilities.
 * `cycleCloseDayOfMonth`/`dueDayOfMonth` are left null because nothing in the
 * Plaid sync writes them for a credit card; only the user's own card settings do.
 */
function seedUndatableCard(email: string, cardName: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedUndatableCard: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', 'Everyday Checking', 'CHECKING', 250000, 'USD')`,
    ).run(checkingId, user.id);

    const cardId = `e2e-card-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, 'CREDIT', 184267, 'USD')`,
    ).run(cardId, user.id, cardName);

    // Designate the funding account, as the app does once a checking account exists.
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(checkingId, user.id);
    return { cardId };
  } finally {
    db.close();
  }
}

test('a card with no statement is reported as undatable, never as "nothing due"', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const cardName = 'Chase Sapphire Reserve';
  const { cardId } = seedUndatableCard(email, cardName);

  // ── Dashboard ──────────────────────────────────────────────────────────────
  await page.goto('/dashboard');
  const hero = page.getByTestId('cash-needed-card');
  await expect(hero).toBeVisible({ timeout: 20_000 });

  // The regression: this exact card used to render "No card payments are due this
  // cycle." while the user owed $1,842.67 on it.
  await expect(hero).not.toContainText('No card payments are due this cycle');
  await expect(page.getByTestId('cash-needed-unknown')).toBeVisible();
  await expect(hero).toContainText(cardName);
  // The balance is stated as a balance — never as an amount we claim is due.
  await expect(hero).toContainText('$1,842.67');

  // ── /cards ─────────────────────────────────────────────────────────────────
  await page.goto('/cards');
  const unknownPanel = page.getByTestId('cards-unknown-due');
  await expect(unknownPanel).toBeVisible({ timeout: 20_000 });
  await expect(unknownPanel).toContainText(cardName);
  await expect(unknownPanel).toContainText('$1,842.67');
  // The card is no longer invisible: it has its own row.
  await expect(page.getByTestId(`card-unknown-${cardId}`)).toBeVisible();
  // …and the summary no longer asserts that nothing is due.
  await expect(page.getByTestId('scenario-summary')).not.toContainText('Nothing due this cycle');
  await expect(page.getByTestId('scenario-unknown')).toBeVisible();
});

/**
 * #277 P2 (TASKS L.4): the MIXED branch — a real total for the datable cards with
 * the undatable card disclosed beside it — had no test at all. Seed one card WITH
 * a statement and one without, and lock both halves of the hero: the figure
 * renders, scoped to "cards we have due dates for", and the excluded card is
 * named in the amber note rather than silently absorbed or silently dropped.
 */
function seedDatedCard(email: string, cardName: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedDatedCard: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const cardId = `e2e-dated-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, 'CREDIT', 52510, 'USD')`,
    ).run(cardId, user.id, cardName);

    // A generated statement with a due date inside the current cycle window —
    // the shape a liabilities-answering issuer produces.
    const inDays = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, ?, ?, ?, 52510, 3500, 0)`,
    ).run(`e2e-stmt-${stamp}`, cardId, inDays(-33), inDays(-3), inDays(10));
    return { cardId };
  } finally {
    db.close();
  }
}

test('the mixed case: a dated-cards total names the undatable card beside it', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const undatableName = 'Chase Sapphire Reserve';
  seedUndatableCard(email, undatableName); // also seeds checking + funding account
  const datedName = 'United Explorer';
  seedDatedCard(email, datedName);

  await page.goto('/dashboard');
  const hero = page.getByTestId('cash-needed-card');
  await expect(hero).toBeVisible({ timeout: 20_000 });

  // The dated card produces a REAL figure — the hero is the number branch, not the
  // "due dates missing" panel and never the "nothing due" claim.
  await expect(page.getByTestId('cash-needed-amount')).toBeVisible();
  await expect(hero).not.toContainText('No card payments are due this cycle');

  // The figure is scoped: it covers the datable cards only, and says so.
  await expect(page.getByTestId('cash-needed-headline')).toContainText(
    'we have due dates for',
  );

  // The undatable card is disclosed by name in the note, not silently dropped.
  const note = page.getByTestId('cash-needed-unknown-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText(undatableName);

  // And the dated card is in the per-due-date rows, not the note.
  await expect(page.getByTestId('due-date-list')).toContainText(datedName);
  await expect(note).not.toContainText(datedName);
});

/**
 * #277-critic (TASKS L.4): a $0 paid-off undatable card must NOT be framed as a
 * withheld obligation. The engine still carries it (so /cards lists it), but the
 * hero number branch, the "Not included" note and the payment-reminders qualifier
 * all read the shared `undatedCardsWithBalance` fence — so on a screen with a real
 * dated figure plus one $0 undatable card, no surface claims a card is being
 * excluded from what's owed. Before the fix these surfaces used the raw list and
 * contradicted the hero/nudge (which already fenced) on the same dashboard.
 */
function seedZeroBalanceMix(email: string, datedName: string, paidOffName: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedZeroBalanceMix: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-zchk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', 'Everyday Checking', 'CHECKING', 250000, 'USD')`,
    ).run(checkingId, user.id);
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(checkingId, user.id);

    // A datable card (generated statement, due date inside the window) → real figure.
    const datedId = `e2e-zdated-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, 'CREDIT', 52510, 'USD')`,
    ).run(datedId, user.id, datedName);
    const inDays = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, ?, ?, ?, 52510, 3500, 0)`,
    ).run(`e2e-zstmt-${stamp}`, datedId, inDays(-33), inDays(-3), inDays(10));

    // A $0 paid-off undatable card: no statement, no cycle dates, zero balance.
    const paidOffId = `e2e-zpaid-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, 'CREDIT', 0, 'USD')`,
    ).run(paidOffId, user.id, paidOffName);
    return { datedId, paidOffId };
  } finally {
    db.close();
  }
}

test('a $0 paid-off undatable card is never framed as a withheld obligation', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const datedName = 'United Explorer';
  const paidOffName = 'Old Store Card';
  seedZeroBalanceMix(email, datedName, paidOffName);

  await page.goto('/dashboard');
  const hero = page.getByTestId('cash-needed-card');
  await expect(hero).toBeVisible({ timeout: 20_000 });

  // Real figure renders (number branch), and the completeness claim is NOT retracted:
  // "pay all N cards in full" — never demoted to "cards we have due dates for".
  await expect(page.getByTestId('cash-needed-amount')).toBeVisible();
  await expect(page.getByTestId('cash-needed-headline')).toContainText('in full this cycle');
  await expect(page.getByTestId('cash-needed-headline')).not.toContainText(
    'we have due dates for',
  );

  // The $0 card is NOT named as excluded — the amber note must be absent entirely.
  await expect(page.getByTestId('cash-needed-unknown-note')).toHaveCount(0);

  // And Home's own all-clear does not claim a card is being withheld. TASKS K.5: this read the
  // reminders card until #369 deleted it, and the Today feed is the better target anyway — its
  // `emptyReason` is built by `undatedCardsWithBalance`, the very rule under test, which fences out
  // a zero-balance card because a card that owes nothing withholds nothing.
  await expect(page.getByTestId('today-feed-card')).not.toContainText('no due date yet');

  // The $0 card is still VISIBLE on /cards (never invisible — #277).
  await page.goto('/cards');
  await expect(page.getByTestId('cards-unknown-due')).toContainText(paidOffName);
});
