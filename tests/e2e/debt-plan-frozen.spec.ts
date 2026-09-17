/**
 * TASKS L.19 — the debt-payoff path prints a payoff date, a payoff order and an extra-per-month
 * from a balance the bank stopped sharing; this locks that the disclosure REACHES the page and the
 * Ask answer, which is the half a builder test cannot see (`loadDebtAccounts` was the narrowing
 * that stripped the fact — DECISIONS #305's disease, on the surface that decision left open).
 *
 * Throwaway signup user, never the shared demo row (the shared-demo lesson). The frozen debt is a
 * CREDIT card beside a HEALTHY loan, so the note has a sibling it must NOT name; the abstention
 * twin seeds a healthy card only, so the planner renders and the note must stay away.
 *
 * DECISIONS #746 extends both walks through the SAVE: the goal card the plan becomes carries a
 * save-day note built from `Goal.frozenAtSave` (the hop #742's critic named), and the abstention
 * twin's saved card carries none.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-debt-frozen-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** One Plaid connection whose bank is fine (synced today): a card, frozen or not, and a live loan. */
function seedDebts(email: string, opts: { cardName: string; cardDroppedAt: string | null }) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedDebts: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const today = new Date().toISOString().slice(0, 10);
    const itemId = `e2e-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Chase', 'ins_56', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-pi-${stamp}`, user.id, itemId, today);

    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CREDIT', '4321', 900000, 'USD', 2399, ?)`,
    ).run(`e2e-card-${stamp}`, user.id, `ref-card-${stamp}`, itemId, opts.cardName, opts.cardDroppedAt);

    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, minimumPaymentCents)
       VALUES (?, ?, 'plaid', ?, ?, 'Auto Loan', 'LOAN', '8801', 1430000, 'USD', 649, 38500)`,
    ).run(`e2e-loan-${stamp}`, user.id, `ref-loan-${stamp}`, itemId);
  } finally {
    db.close();
  }
}

async function ask(page: Page, question: string) {
  await page.goto('/ask');
  await page.getByTestId('ask-input').fill(question);
  await page.getByTestId('ask-submit').click();
  const answer = page.getByTestId('ask-answer');
  await expect(answer).toBeVisible({ timeout: 20_000 });
  return answer;
}

test('the Debt Freedom planner and both Ask debt answers name the frozen card, never the live loan', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const cardName = 'Chase Sapphire';
  const droppedAt = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  seedDebts(email, { cardName, cardDroppedAt: droppedAt });

  // ── /goals: the planner prints "Debt-free by <month>" over the frozen balance ─────────────
  await page.goto('/goals');
  await expect(page.getByTestId('debt-planner')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('debt-free-hero')).toContainText('Debt-free by');
  const note = page.getByTestId('debt-planner-frozen');
  await expect(note).toBeVisible();
  await expect(note).toContainText(`Your bank stopped sharing ${cardName}`);
  await expect(note).toContainText('the balance behind this payoff plan is the last one we saw');
  // The card mechanism, not the loan one: charges AND payments have gone unseen.
  await expect(note).toContainText('including any payment you have made or any new charge');
  await expect(note).not.toContainText('Auto Loan');
  // In-app, so the route is named as a destination, never a position.
  await expect(note).toContainText('Accounts shows the connection');
  // The order list still prints BOTH debts — the disclosure qualified the plan, it did not shrink it.
  await expect(page.getByTestId('debt-order')).toContainText(cardName);
  await expect(page.getByTestId('debt-order')).toContainText('Auto Loan');

  // ── /goals: SAVE the plan — the card it becomes carries the fact forward (DECISIONS #746) ──
  // The saved row persists this plan's total as its target; the planner's note above the save
  // control does not travel with it, so the card needs its own, built from the save-day stamp.
  await page.getByTestId('debt-planner-save-goal').click();
  const savedCard = page.getByTestId('goal-debt-free');
  await expect(savedCard).toBeVisible({ timeout: 20_000 });
  await expect(savedCard).toContainText('Re-check in Ask Aimplifi');
  const savedNote = page.getByTestId('goal-debt-free-frozen');
  await expect(savedNote).toBeVisible();
  await expect(savedNote).toContainText('When this goal was saved on');
  await expect(savedNote).toContainText('had stopped sharing that balance');
  // Planner save uses the on-track date, so extra is $0 and the note names both figures.
  await expect(savedNote).toContainText(
    'the debt total and the on-track claim here were both worked out from the last balance we saw',
  );
  await expect(savedNote).not.toContainText(' it suggests');
  // A save-day fact: no kind, no bank, no direction, no remedy of its own — the card's own
  // "re-check in Ask" sentence above it is the remedy.
  await expect(savedNote).not.toContainText(cardName);
  await expect(savedNote).not.toContainText('higher or lower');
  await expect(savedNote).not.toContainText('Accounts shows');

  // ── Ask: the forward answer ("when am I debt-free?") ───────────────────────────────────────
  const forward = await ask(page, 'when will I be debt-free?');
  await expect(forward).toContainText(`Your bank stopped sharing ${cardName}`);
  await expect(forward).toContainText('this payoff plan');
  await expect(forward).not.toContainText('Auto Loan');

  // ── Ask: the inverse answer ("be debt-free by <date>") prints an extra-per-month ───────────
  const inverse = await ask(page, 'be debt-free by december 2027');
  await expect(inverse).toContainText(`Your bank stopped sharing ${cardName}`);
  await expect(inverse).toContainText('the total debt and the extra needed to clear it');
});

test('with every debt still shared, the planner and both answers carry no caveat', async ({
  page,
}) => {
  // The abstention twin. A caveat on a plan no frozen account feeds is a false hedge; here the
  // planner MUST render (a real card and loan) so the absence is an absence and not an empty page.
  const email = await signUpThrowaway(page);
  seedDebts(email, { cardName: 'Freedom Card', cardDroppedAt: null });

  await page.goto('/goals');
  await expect(page.getByTestId('debt-planner')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('debt-order')).toContainText('Freedom Card');
  await expect(page.getByTestId('debt-planner-frozen')).toHaveCount(0);

  // The saved card is the abstention's second half: a real debt-free goal renders (so the absence
  // is an absence, not an empty list) and carries no save-day note over a total nothing frozen fed.
  await page.getByTestId('debt-planner-save-goal').click();
  const savedCard = page.getByTestId('goal-debt-free');
  await expect(savedCard).toBeVisible({ timeout: 20_000 });
  await expect(savedCard).toContainText('Re-check in Ask Aimplifi');
  await expect(page.getByTestId('goal-debt-free-frozen')).toHaveCount(0);

  const forward = await ask(page, 'when will I be debt-free?');
  await expect(forward).toContainText('debt-free');
  await expect(forward).not.toContainText('stopped sharing');

  const inverse = await ask(page, 'be debt-free by december 2027');
  await expect(inverse).toContainText('December 2027');
  await expect(inverse).not.toContainText('stopped sharing');
});
