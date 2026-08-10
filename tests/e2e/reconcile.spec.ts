/**
 * Wave 4.6 slice 5 — cross-provider reconciliation, end to end.
 *
 * The exact scenario from the spec (§10 slice 5): seed a SimpleFIN account, "connect" a live Plaid
 * twin (same mask), and prove that linking them stops net worth from double-counting the balance —
 * driving the REAL confirm/undo server actions through the /accounts UI, then reversing it (R9).
 *
 * Seeding is direct-to-SQLite (better-sqlite3) on the off-tree e2e DB, mirroring
 * mobile-overflow.spec.ts. The two accounts differ only by provider + balance; the shared mask
 * ····1234 gives the #192 detector a high-confidence match, and the missing SimpleFinConnection
 * (vs. the present PlaidItem) makes exactly the Plaid side live — the R3 direction the candidate
 * engine requires.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { openAccountCleanup } from './helpers/account-cleanup';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-reconcile-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** Overlapping history for the slice-6 register test: the successor re-imported the
 *  predecessor's two purchases, plus one of its own after the span. */
function seedOverlapTransactions(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedOverlapTransactions: user ${email} not found`);
    const pred = db
      .prepare("SELECT id FROM Account WHERE userId = ? AND provider = 'simplefin'")
      .get(user.id) as { id: string } | undefined;
    const succ = db.prepare("SELECT id FROM Account WHERE userId = ? AND provider = 'plaid'").get(user.id) as
      | { id: string }
      | undefined;
    if (!pred || !succ) throw new Error('seedOverlapTransactions: pair not found');
    const ins = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, providerRef, date, amountCents, rawDescriptor, status)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED')`,
    );
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    ins.run(`e2e-rt-p1-${suffix}`, pred.id, 'p1', '2026-05-01', -5000, 'COFFEE SHOP');
    ins.run(`e2e-rt-p2-${suffix}`, pred.id, 'p2', '2026-06-10', -7000, 'GROCERY MART');
    ins.run(`e2e-rt-s1-${suffix}`, succ.id, 's1', '2026-05-01', -5000, 'COFFEE SHOP');
    ins.run(`e2e-rt-s2-${suffix}`, succ.id, 's2', '2026-06-10', -7000, 'GROCERY MART');
    ins.run(`e2e-rt-s3-${suffix}`, succ.id, 's3', '2026-07-01', -3000, 'GAS STATION');
  } finally {
    db.close();
  }
}

/** A stale SimpleFIN predecessor ($2,400.00) + a live Plaid successor ($2,500.00), same mask. */
function seedReconcilePair(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedReconcilePair: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-recon-item-${suffix}`;
    // Stale SimpleFIN predecessor — no SimpleFinConnection row, so it is NOT live.
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, 'Chase Checking (old)', 'CHECKING', '1234', 240000, 'USD')`,
    ).run(`e2e-recon-pred-${suffix}`, uid, `sf-${suffix}`);
    // Live Plaid successor — its PlaidItem exists, so isAccountLive() is true.
    db.prepare(`INSERT INTO PlaidItem (id, userId, itemId, accessToken) VALUES (?, ?, ?, 'ct-e2e')`).run(
      `e2e-recon-item-row-${suffix}`,
      uid,
      itemId,
    );
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Chase Checking', 'CHECKING', '1234', 250000, 'USD')`,
    ).run(`e2e-recon-succ-${suffix}`, uid, `pl-${suffix}`, itemId);
  } finally {
    db.close();
  }
}

// Armed for the STATUS §OPEN "intermittent whole-page DOM duplication on /accounts"
// (the strict-mode "getByTestId('reconcile-candidates') resolved to 2 elements" failure
// originates here). The cause is an unconfirmed hydration mismatch; when it next fires,
// this surfaces React's own hydration error (prod still logs the minified #418/#421/#423)
// and any pageerror straight into the run output, so the opaque "2 elements" failure
// arrives already named. It changes no assertion — it only observes. Do NOT loosen the
// strict locators to "fix" the flake; that would hide a real duplicate-render bug.
test.beforeEach(({ page }) => {
  page.on('console', (msg) => {
    const t = msg.text();
    if (/hydrat|Minified React error #(418|421|422|423|425)|did not match|server rendered/i.test(t)) {
      console.log(`[reconcile hydration] ${t}`);
    }
  });
  page.on('pageerror', (err) => {
    console.log(`[reconcile pageerror] ${err.message}`);
  });
});

/** L.9: one stale SimpleFIN Roth IRA + TWO live Plaid IRAs (Roth ····5351, Traditional ····1548). */
function seedRetirementTrio(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedRetirementTrio: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // Stale SimpleFIN predecessor — the owner's exact row, bank-doubled number and all.
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, 'Charles Schwab US Roth Contributory IRA ...396 (396)', 'INVESTMENT', NULL, 500000, 'USD')`,
    ).run(`e2e-l9-pred-${suffix}`, uid, `sf-${suffix}`);
    // Two live Plaid items, one Roth and one Traditional, each named like the owner's rows.
    for (const [n, itemSuffix] of [
      ['Roth IRA Brokerage Account - ****5351', 'roth'],
      ['Traditional IRA Brokerage Account - ****1548', 'trad'],
    ] as const) {
      const itemId = `e2e-l9-item-${itemSuffix}-${suffix}`;
      db.prepare(`INSERT INTO PlaidItem (id, userId, itemId, accessToken) VALUES (?, ?, ?, 'ct-e2e')`).run(
        `e2e-l9-itemrow-${itemSuffix}-${suffix}`,
        uid,
        itemId,
      );
      db.prepare(
        `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, subtype, mask, currentBalanceCents, currency)
         VALUES (?, ?, 'plaid', ?, ?, ?, 'INVESTMENT', ?, ?, 510000, 'USD')`,
      ).run(
        `e2e-l9-succ-${itemSuffix}-${suffix}`,
        uid,
        `pl-${itemSuffix}-${suffix}`,
        itemId,
        n,
        itemSuffix === 'roth' ? 'roth' : 'ira',
        itemSuffix === 'roth' ? '5351' : '1548',
      );
    }
  } finally {
    db.close();
  }
}

/** L.9: one stale SimpleFIN checking row + two live Plaid checking twins (the ambiguity shape). */
function seedAmbiguousTrio(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedAmbiguousTrio: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, 'BofA Checking (old)', 'CHECKING', '5678', 100000, 'USD')`,
    ).run(`e2e-amb-pred-${suffix}`, uid, `sf-${suffix}`);
    for (const which of ['b', 'c'] as const) {
      const itemId = `e2e-amb-item-${which}-${suffix}`;
      db.prepare(`INSERT INTO PlaidItem (id, userId, itemId, accessToken) VALUES (?, ?, ?, 'ct-e2e')`).run(
        `e2e-amb-itemrow-${which}-${suffix}`,
        uid,
        itemId,
      );
      db.prepare(
        `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
         VALUES (?, ?, 'plaid', ?, ?, 'BofA Checking', 'CHECKING', '5678', 100000, 'USD')`,
      ).run(`e2e-amb-succ-${which}-${suffix}`, uid, `pl-${which}-${suffix}`, itemId);
    }
  } finally {
    db.close();
  }
}

test('reconciling a stale account with its live twin stops net worth from doubling, and undo restores it', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedReconcilePair(email);
  await page.goto('/accounts');
  await openAccountCleanup(page);

  // Both accounts count → $2,400 + $2,500 = $4,900.00, and a "continue this account?" candidate.
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/4,900/, { timeout: 20_000 });
  await expect(page.getByTestId('reconcile-candidates')).toBeVisible();

  // Combine → the stale predecessor stops counting → $2,500.00, and the pair is disclosed once.
  await page.getByTestId('reconcile-confirm').click();
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/2,500/, { timeout: 20_000 });
  await expect(page.getByTestId('reconcile-combined')).toBeVisible();
  await expect(page.getByTestId('reconcile-candidates')).toHaveCount(0);
  await expect(page.getByTestId('duplicate-accounts-warning')).toHaveCount(0);

  // Undo → both count again → $4,900.00, and the candidate returns (R9 reversible).
  await page.getByTestId('reconcile-undo').click();
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/4,900/, { timeout: 20_000 });
  await expect(page.getByTestId('reconcile-candidates')).toBeVisible();
});

test('slice 6: the register agrees with the dashboard after combining — overlap rows count once', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedReconcilePair(email);
  seedOverlapTransactions(email);
  await page.goto('/accounts');
  await openAccountCleanup(page);

  // The confirm card discloses the REAL claim span from the predecessor's own history
  // (slice-6 critics C-6/C-12): span [2026-05-01, 2026-06-10], cutover defaulted to its
  // last transaction date — not `today` — and the input's min blocks an invalid early pick.
  await expect(page.getByTestId('reconcile-candidates')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reconcile-cutover')).toHaveValue('2026-06-10');
  await expect(page.getByTestId('reconcile-span-disclosure')).toContainText('from 2026-05-01 through 2026-06-10');

  // Pre-link: the register shows both providers' copies (5 rows, $270.00 out).
  await page.goto('/transactions');
  await expect(page.getByTestId('summary-out')).toContainText('270.00', { timeout: 20_000 });

  // Combine, then the register must match the dashboard: 3 real transactions, $150.00 out
  // (pre-fix: still 5 rows / $270.00 — an 80% inflation contradicting /reports on screen).
  await page.goto('/accounts');
  await openAccountCleanup(page);
  await page.getByTestId('reconcile-confirm').click();
  await expect(page.getByTestId('reconcile-combined')).toBeVisible({ timeout: 20_000 });
  await page.goto('/transactions');
  await expect(page.getByTestId('summary-out')).toContainText('150.00', { timeout: 20_000 });
});

test('L.9: a Roth is never offered against a Traditional — the wrong pair is vetoed, the right one offered', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedRetirementTrio(email);
  await page.goto('/accounts');
  await openAccountCleanup(page);

  // The veto dissolves the owner's ambiguity into ONE offerable candidate: the Roth→Roth pair.
  // No ambiguity card (the Traditional is not "one we can't tell apart" — it is provably a
  // different account), and no Traditional anywhere in the candidate rows.
  await expect(page.getByTestId('reconcile-candidates')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reconcile-candidate')).toHaveCount(1);
  await expect(page.getByTestId('reconcile-candidate')).toContainText('Roth IRA Brokerage Account');
  await expect(page.getByTestId('reconcile-candidate')).not.toContainText('Traditional');
  await expect(page.getByTestId('reconcile-ambiguities')).toHaveCount(0);

  // Each number prints exactly once: the bank-doubled "...396 (396)" collapses, and the Plaid
  // qualifier drops the "····5351" the name already shows.
  const row = page.getByTestId('reconcile-candidate');
  // (toContainText concatenates sibling elements without a space: name span + qualifier span.)
  await expect(row).toContainText('Charles Schwab US Roth Contributory IRA ...396(SimpleFIN)');
  await expect(row).not.toContainText('(396)');
  await expect(row).toContainText('(Plaid)');
  await expect(row).not.toContainText('····5351');
});

test('L.9: one stale row matching two live accounts offers NEITHER — stated, with no Combine control', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedAmbiguousTrio(email);
  await page.goto('/accounts');
  await openAccountCleanup(page);

  // The withheld conclusion renders as a disclosure, never silence and never a Combine button.
  await expect(page.getByTestId('reconcile-ambiguities')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reconcile-ambiguity')).toHaveCount(1);
  await expect(page.getByTestId('reconcile-ambiguity-matches')).toContainText('Looks like 2 of your live accounts:');
  await expect(page.getByTestId('reconcile-candidates')).toHaveCount(0);
  await expect(page.getByTestId('reconcile-confirm')).toHaveCount(0);

  // The resolution path the how-to names exists: both pairs are on the possible-duplicate
  // notice (an ambiguous pair is never candidate-suppressed).
  await expect(page.getByTestId('duplicate-accounts-warning')).toBeVisible();
});
