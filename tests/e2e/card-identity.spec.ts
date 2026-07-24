/**
 * #298 — /cards must tell same-named cards apart.
 *
 * Owner-reported 2026-07-24 from a live screenshot: THREE cards named `CREDIT CARD` and TWO named
 * `Venture`, each with its own amount due, and a headline reading "Do this first: pay Venture
 * $9,250.93" while he held two Ventures. The page rendered the card NAME and nothing else.
 *
 * Seeds two same-named cards with different last-4s and proves the page distinguishes them — on the
 * card itself AND in the "Do this first" instruction, which is the line a reader actually acts on.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-cardid-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Two cards sharing ONE name, differing only by last-4 — the owner's shape. */
function seedTwoSameNamedCards(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedTwoSameNamedCards: user ${email} not found`);
    const uid = user.id;
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // A funding account, so the headline has somewhere to draw from.
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', 'Everyday Checking', 'CHECKING', 5000000, 'USD')`,
    ).run(`e2e-ci-chk-${stamp}`, uid);

    const mk = (suffix: string, mask: string, balance: number, min: number) => {
      const cardId = `e2e-ci-${suffix}-${stamp}`;
      db.prepare(
        `INSERT INTO Account (id, userId, provider, name, type, mask, currentBalanceCents, currency)
         VALUES (?, ?, 'plaid', 'CREDIT CARD', 'CREDIT', ?, ?, 'USD')`,
      ).run(cardId, uid, mask, balance);
      db.prepare(
        `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(`e2e-ci-stmt-${suffix}-${stamp}`, cardId, inDays(-33), inDays(-3), inDays(10), balance, min);
      return cardId;
    };
    // The bigger one is the "Do this first" card.
    const big = mk('big', '0977', 667968, 6600);
    const small = mk('small', '2927', 91330, 4000);
    return { big, small };
  } finally {
    db.close();
  }
}

test('two cards with the SAME name are told apart on /cards, and in the pay-first instruction', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const { big, small } = seedTwoSameNamedCards(email);

  await page.goto('/cards');
  const bigCard = page.getByTestId(`card-${big}`);
  const smallCard = page.getByTestId(`card-${small}`);
  await expect(bigCard).toBeVisible({ timeout: 20_000 });
  await expect(smallCard).toBeVisible();

  // Each card carries its own last-4 — the field that differs.
  await expect(page.getByTestId(`card-identity-${big}`)).toHaveText('····0977');
  await expect(page.getByTestId(`card-identity-${small}`)).toHaveText('····2927');

  // Both cards render the same NAME, so the identity is the only thing separating them.
  await expect(bigCard).toContainText('CREDIT CARD');
  await expect(smallCard).toContainText('CREDIT CARD');

  // THE LOCK: the instruction a reader acts on must name WHICH card.
  const first = page.getByTestId('do-this-first');
  await expect(first).toContainText('····0977');
  await expect(first).not.toContainText('····2927');
});

test('a card with no last-4 from the bank says so rather than showing a guessed number', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ids: string[] = [];
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', 'Everyday Checking', 'CHECKING', 5000000, 'USD')`,
    ).run(`e2e-ci2-chk-${stamp}`, user.id);
    // Two same-named cards, NEITHER with a mask — nothing in the data separates them.
    for (const [i, bal] of [500000, 300000].entries()) {
      const cardId = `e2e-ci2-${i}-${stamp}`;
      ids.push(cardId);
      db.prepare(
        `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
         VALUES (?, ?, 'simplefin', 'CREDIT CARD', 'CREDIT', ?, 'USD')`,
      ).run(cardId, user.id, bal);
      db.prepare(
        `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
         VALUES (?, ?, ?, ?, ?, ?, 3500, 0)`,
      ).run(`e2e-ci2-stmt-${i}-${stamp}`, cardId, inDays(-33), inDays(-3), inDays(10), bal);
    }
  } finally {
    db.close();
  }

  await page.goto('/cards');
  await expect(page.getByTestId(`card-${ids[0]}`)).toBeVisible({ timeout: 20_000 });

  // Both are numbered, and neither shows an invented card number.
  const a = page.getByTestId(`card-identity-${ids[0]}`);
  const b = page.getByTestId(`card-identity-${ids[1]}`);
  await expect(a).toContainText('no card number on file');
  await expect(b).toContainText('no card number on file');
  expect(await a.innerText()).not.toBe(await b.innerText());
  await expect(a).not.toContainText('····');

  // The numbering must read 1, 2, 3 DOWN THE PAGE — a "3." rendered above a "1." would claim a
  // position it does not have. Read them in DOM order, not by seeded id.
  const inDomOrder = await page
    .locator('[data-testid^="card-identity-"]')
    .evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
  expect(inDomOrder.length).toBe(2);
  expect(inDomOrder[0].startsWith('1. ')).toBe(true);
  expect(inDomOrder[1].startsWith('2. ')).toBe(true);
});
