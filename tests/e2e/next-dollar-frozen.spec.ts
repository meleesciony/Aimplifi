/**
 * TASKS L.19 residual (5) — the next-dollar ranking names a debt to send extra money to; this
 * locks that the frozen-balance disclosure REACHES /coach and the Ask answer, which is the half a
 * builder test cannot see (`src/server/coach.ts` was the narrowing that stripped the fact —
 * DECISIONS #742's disease, one read path over).
 *
 * Throwaway signup user, never the shared demo row (the shared-demo lesson). The frozen debt is a
 * 12% LOAN beside a HEALTHY 6.49% loan, so the note has a sibling it must NOT name; the abstention
 * twin seeds the same pair with nothing frozen, so the card renders the same instruction and the
 * note must stay away.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-nd-frozen-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** One Plaid connection whose bank is fine (synced today): a 12% loan, frozen or not, and a live 6.49% loan. */
function seedLoans(email: string, opts: { loanName: string; loanDroppedAt: string | null }) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedLoans: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const today = new Date().toISOString().slice(0, 10);
    const itemId = `e2e-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Chase', 'ins_56', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-pi-${stamp}`, user.id, itemId, today);

    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, minimumPaymentCents, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'LOAN', '7711', 500000, 'USD', 1200, 15000, ?)`,
    ).run(`e2e-loan-a-${stamp}`, user.id, `ref-loan-a-${stamp}`, itemId, opts.loanName, opts.loanDroppedAt);

    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, minimumPaymentCents)
       VALUES (?, ?, 'plaid', ?, ?, 'Auto Loan', 'LOAN', '8801', 1430000, 'USD', 649, 38500)`,
    ).run(`e2e-loan-b-${stamp}`, user.id, `ref-loan-b-${stamp}`, itemId);
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

test('the next-dollar card and the Ask answer name the frozen loan they point at, never the live one', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const loanName = 'Personal Loan';
  const droppedAt = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  seedLoans(email, { loanName, loanDroppedAt: droppedAt });

  // ── /coach: the instruction names the frozen loan ──────────────────────────────────────────
  await page.goto('/coach');
  const card = page.getByTestId('next-dollar-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('next-dollar-headline')).toContainText(`Next extra dollar: ${loanName} (12.00% APR)`);
  const note = page.getByTestId('next-dollar-frozen');
  await expect(note).toBeVisible();
  await expect(note).toContainText(`Your bank stopped sharing ${loanName}`);
  // The loan mechanism: no direction, and the one thing the ranking's reader needs to hear.
  await expect(note).toContainText('including whether it is still open');
  await expect(note).not.toContainText('Auto Loan');
  await expect(note).not.toContainText(/may be lower|only be lower/);
  // In-app, so the route is named as a destination, never a position.
  await expect(note).toContainText('Accounts shows the connection');
  // DISCLOSE, never wall off: the reasoning still prints the named loan and its rate.
  await expect(page.getByTestId('next-dollar-why')).toContainText(`${loanName} is 12.00%`);

  // ── Ask: the same plan, the same qualifier ─────────────────────────────────────────────────
  const answer = await ask(page, 'Where should my next dollar go?');
  await expect(page.getByTestId('ask-headline')).toContainText(`Next extra dollar: ${loanName}`);
  await expect(answer).toContainText(`Your bank stopped sharing ${loanName}`);
  await expect(answer).toContainText('including whether it is still open');
});

test('with every loan still shared, the card and the answer carry no caveat', async ({ page }) => {
  // The abstention twin. A caveat on a ranking no frozen account feeds is a false hedge; here the
  // card MUST name the same loan so the absence is an absence and not a different branch.
  const email = await signUpThrowaway(page);
  seedLoans(email, { loanName: 'Personal Loan', loanDroppedAt: null });

  await page.goto('/coach');
  await expect(page.getByTestId('next-dollar-card')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('next-dollar-headline')).toContainText('Next extra dollar: Personal Loan (12.00% APR)');
  await expect(page.getByTestId('next-dollar-frozen')).toHaveCount(0);

  const answer = await ask(page, 'Where should my next dollar go?');
  await expect(page.getByTestId('ask-headline')).toContainText('Next extra dollar: Personal Loan');
  await expect(answer).not.toContainText('stopped sharing');
});
