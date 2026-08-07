/**
 * #297 — the "Combined accounts" card when ONE live account supersedes TWO old rows.
 *
 * Owner-reported 2026-07-24 (STATUS §Combined-accounts): the card listed
 * "Venture (Plaid ····6271)" twice, identically, with two byte-identical "Undo" buttons —
 * "two identical rows I can't tell apart". `AccountReconciliation.successorAccountId` is
 * deliberately NOT unique (schema.prisma:193), so this is valid data the card rendered badly.
 *
 * This spec seeds that exact shape and locks the cure end to end: ONE account block, a stated
 * "combines 2", a distinct identity line per old account, and two Undo controls that differ in
 * BOTH their visible face and their accessible name — then drives the real undoReconciliation
 * server action on a chosen one and proves only that link was reversed.
 *
 * Seeding is direct-to-SQLite (better-sqlite3) on the off-tree e2e DB, mirroring reconcile.spec.ts.
 * The reconciliation rows are inserted already-confirmed: the CANDIDATE→confirm path is covered by
 * reconcile.spec.ts, and the detector proposes one pair at a time, so seeding the post-confirm
 * state is the only way to reach a two-predecessor card.
 */
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { openAccountCleanup } from './helpers/account-cleanup';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-combined-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * The owner's shape: TWO stale SimpleFIN "Venture" rows (no mask column — which is exactly why the
 * pre-#297 copy rendered the constant "SimpleFIN" for both) already combined into ONE live Plaid
 * "Venture ····6271". Both predecessors carry the SAME name, so nothing in the DATA distinguishes
 * them — distinctness has to come from construction.
 */
function seedTwoPredecessorsOneSuccessor(email: string, predName = 'Venture') {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedTwoPredecessorsOneSuccessor: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-comb-item-${suffix}`;
    const predA = `e2e-comb-pred-a-${suffix}`;
    const predB = `e2e-comb-pred-b-${suffix}`;
    const succ = `e2e-comb-succ-${suffix}`;

    const insAccount = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, ?, 'CREDIT', NULL, ?, 'USD')`,
    );
    insAccount.run(predA, uid, `sf-a-${suffix}`, predName, -120000);
    insAccount.run(predB, uid, `sf-b-${suffix}`, predName, -130000);

    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken) VALUES (?, ?, ?, 'ct-e2e')`,
    ).run(`e2e-comb-item-row-${suffix}`, uid, itemId);
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Venture', 'CREDIT', '6271', -140000, 'USD')`,
    ).run(succ, uid, `pl-${suffix}`, itemId);

    const insLink = db.prepare(
      `INSERT INTO AccountReconciliation
         (id, userId, predecessorAccountId, successorAccountId, cutoverDate, matchSignal, confidence, confirmedByUserAt)
       VALUES (?, ?, ?, ?, '2026-07-18', 'name', 'medium', CURRENT_TIMESTAMP)`,
    );
    insLink.run(`e2e-comb-link-a-${suffix}`, uid, predA, succ);
    insLink.run(`e2e-comb-link-b-${suffix}`, uid, predB, succ);
    return { predA, predB, succ };
  } finally {
    db.close();
  }
}

test('two old accounts combined into one live account render as ONE block with tellable-apart Undo controls', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedTwoPredecessorsOneSuccessor(email);
  await page.goto('/accounts');
  await openAccountCleanup(page);

  const card = page.getByTestId('reconcile-combined');
  await expect(card).toBeVisible({ timeout: 20_000 });

  // ONE account block, not two identical rows — the reported defect.
  await expect(card.getByTestId('reconcile-combined-account')).toHaveCount(1);
  // ...listing BOTH old accounts inside it.
  await expect(card.getByTestId('reconcile-combined-pair')).toHaveCount(2);

  // The card states the fact the flat list hid.
  await expect(card.getByTestId('reconcile-combines-note')).toHaveText(/Combines 2 old accounts/);

  // Each old account is individually identified, despite identical names and no mask.
  const lines = await card.getByTestId('reconcile-combined-pair').allInnerTexts();
  expect(lines[0]).toContain('Old account 1 of 2');
  expect(lines[1]).toContain('Old account 2 of 2');

  // THE LOCK: neither the visible face nor the accessible name may tie.
  const undos = card.getByTestId('reconcile-undo');
  await expect(undos).toHaveCount(2);
  const faces = await undos.allInnerTexts();
  expect(faces[0].trim()).not.toBe(faces[1].trim());
  const aria = await undos.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(aria[0]).not.toBe(aria[1]);
  expect(new Set(aria).size).toBe(2);
});

test('undoing one of the two links reverses only that link — the other stays combined', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedTwoPredecessorsOneSuccessor(email);
  await page.goto('/accounts');
  await openAccountCleanup(page);

  const card = page.getByTestId('reconcile-combined');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('reconcile-combined-pair')).toHaveCount(2);

  // Drive the REAL undoReconciliation server action on the second old account.
  await card.getByTestId('reconcile-undo').nth(1).click();

  // The card survives with exactly one old account left, and drops the "combines 2" note.
  const cardAfter = page.getByTestId('reconcile-combined');
  await expect(cardAfter.getByTestId('reconcile-combined-pair')).toHaveCount(1, { timeout: 20_000 });
  await expect(cardAfter.getByTestId('reconcile-combines-note')).toHaveCount(0);
  // A lone Undo needs no disambiguation.
  await expect(cardAfter.getByTestId('reconcile-undo')).toHaveText('Undo');
  // ...and the remaining line reverts to the single-source phrasing.
  await expect(cardAfter.getByTestId('reconcile-combined-pair')).toContainText(
    'Continued from your old account Venture (SimpleFIN)',
  );
});

/**
 * The demo seed creates NO AccountReconciliation rows (prisma/seed.ts), so /accounts as the demo
 * user early-returns null for this card — which means the repo's own axe scan and mobile-overflow
 * sweep have never once seen this markup. Both gates are re-run here against a seeded card, so the
 * nested list, the new aria-labels and the now-variable-length button face are actually covered.
 * That blind spot is precisely how the original mobile /accounts defect shipped (Wave M).
 */
test('the combined card is WCAG AA clean and fits every phone width, even with a long bank name', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedTwoPredecessorsOneSuccessor(email, 'Venture Signature Rewards Preferred Cash Plus Account');
  await page.goto('/accounts');
  await openAccountCleanup(page);
  await expect(page.getByTestId('reconcile-combined')).toBeVisible({ timeout: 20_000 });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // Long, unbroken-ish names now ride ON the button face, so the page must still not scroll
  // sideways at any real phone width (the #265/#276 class of defect).
  for (const width of [360, 393, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(async () => {
      const m = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      expect(m.scrollWidth, `/accounts combined card at ${width}px`).toBeLessThanOrEqual(
        m.clientWidth + 1,
      );
    }).toPass({ timeout: 10_000 });
  }
});
