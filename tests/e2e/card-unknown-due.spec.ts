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
import { expect, test, type Page } from '@playwright/test';
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
  const db = new Database(file, { timeout: 15_000 });
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
