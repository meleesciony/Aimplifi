/**
 * #296 — two Plaid connections to the SAME bank, end to end.
 *
 * The owner-reported defect of 2026-07-24: with the same real U.S. Bank loan arriving on two
 * separate Plaid connections, the duplicate card rendered two byte-identical
 * "Disconnect U.S. Bank (Plaid ····2927)" buttons — same label, same aria-label, same account
 * name, same last-4 — so there was no way to know which connection a tap would cut. One of the
 * two connections also fed a second account, which made the wrong tap materially worse.
 *
 * Every assertion here is written ORDER-AGNOSTICALLY: the two PlaidItem rows are inserted without
 * an explicit createdAt, so they can land in the same DB second and WHICH one is numbered
 * "connection 1" is unspecified. The numbers are still distinct, and the copy claims no link
 * order — so the contract under test is distinctness plus correct pairing of radius to connection,
 * never a fixed ordinal.
 *
 * Seeding is direct-to-SQLite (better-sqlite3) on the off-tree e2e DB, the reconcile.spec.ts
 * pattern. A demo user cannot be used: EXCLUDED_PROVIDERS drops every demo row before pairing,
 * and all three mutations are demo-fenced.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-dupconn-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * Two live U.S. Bank Plaid connections, each feeding its own copy of the loan PLUS one card that
 * exists nowhere else. Both loan rows carry the same mask and the same balance, so the #192
 * detector flags them 'high' on mask + identical balance.
 *
 * The unique card on EACH side is load-bearing since TASKS L.10: a pair whose duplicate rows can
 * be resolved by disconnecting one whole connection is now offered a one-tap Combine instead, and
 * the advisory card correctly steps aside for it (one message per pair). Here neither direction
 * is safe — disconnecting either connection would freeze a card that is nobody's duplicate — so
 * this is the state that still belongs to the advisory card. It is also a STRICTER test of #296's
 * contract than the original fixture: both connections now feed the same NUMBER of accounts, so
 * the blast-radius text can no longer be what tells the two controls apart.
 */
function seedTwoUsBankConnections(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedTwoUsBankConnections: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemA = `e2e-dup-item-a-${suffix}`;
    const itemB = `e2e-dup-item-b-${suffix}`;
    const insItem = db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', 'U.S. Bank', '2026-07-24')`,
    );
    insItem.run(`e2e-dup-item-row-a-${suffix}`, uid, itemA);
    insItem.run(`e2e-dup-item-row-b-${suffix}`, uid, itemB);
    const insAcct = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, ?, ?, ?, 'USD')`,
    );
    insAcct.run(`e2e-dup-loan-a-${suffix}`, uid, `pl-la-${suffix}`, itemA, 'Loan - 2927', 'LOAN', '2927', 2380042);
    insAcct.run(`e2e-dup-card-a-${suffix}`, uid, `pl-ca-${suffix}`, itemA, 'CREDIT CARD', 'CREDIT', '0977', 120000);
    insAcct.run(`e2e-dup-loan-b-${suffix}`, uid, `pl-lb-${suffix}`, itemB, 'Loan - 2927', 'LOAN', '2927', 2380042);
    // Load-bearing since TASKS L.10 — see the comment above this function.
    insAcct.run(`e2e-dup-card-b-${suffix}`, uid, `pl-cb-${suffix}`, itemB, 'CREDIT CARD', 'CREDIT', '0978', 95000);
  } finally {
    db.close();
  }
}

async function texts(page: Page, testId: string): Promise<string[]> {
  return (await page.getByTestId(testId).allInnerTexts()).map((t) => t.trim());
}

test('two connections to one bank are told apart on the duplicate card, without tapping anything', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedTwoUsBankConnections(email);
  await page.goto('/accounts');

  await expect(page.getByTestId('duplicate-accounts-warning')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('duplicate-pair')).toHaveCount(1);

  // THE REGRESSION. Pre-#296 both buttons read "Disconnect U.S. Bank (Plaid ····2927)".
  const faceA = (await page.getByTestId('duplicate-resolve-a').innerText()).trim();
  const faceB = (await page.getByTestId('duplicate-resolve-b').innerText()).trim();
  expect(faceA).not.toBe(faceB);

  // …and the accessible names too: identical labels are invisible to an axe scan.
  const ariaA = await page.getByTestId('duplicate-resolve-a').getAttribute('aria-label');
  const ariaB = await page.getByTestId('duplicate-resolve-b').getAttribute('aria-label');
  expect(ariaA).toBeTruthy();
  expect(ariaB).toBeTruthy();
  expect(ariaA).not.toBe(ariaB);

  // The blast radius is on the button FACE, before the tap that needs it. Both connections feed
  // two accounts here, so the radius is IDENTICAL on both sides — the distinctness asserted above
  // therefore rests entirely on the ordinal breaker, which is the contract #296 locked.
  const bothFaces = `${faceA}\n${faceB}`;
  expect(faceA).toContain('2 accounts stop updating');
  expect(faceB).toContain('2 accounts stop updating');
  expect(bothFaces).toContain('connection 1');
  expect(bothFaces).toContain('connection 2');

  // Which connection each row sits on, numbered the same way in both places on the page.
  const connectionLines = (await texts(page, 'duplicate-side-connection')).sort();
  expect(connectionLines).toEqual([
    'Plaid: U.S. Bank · connection 1 of 2 · last synced 2026-07-24',
    'Plaid: U.S. Bank · connection 2 of 2 · last synced 2026-07-24',
  ]);

  // What each connection carries — visible without arming anything.
  const feeds = (await texts(page, 'duplicate-side-feeds')).sort();
  expect(feeds).toEqual([
    'Also feeds 1 other account: CREDIT CARD ····0977',
    'Also feeds 1 other account: CREDIT CARD ····0978',
  ]);

  // No one-tap Combine here, and that is the honest answer rather than an omission: disconnecting
  // either connection would freeze the card only IT feeds (TASKS L.10).
  //
  // UPDATED for #305, which changed this deliberately: rendering NOTHING made "we checked and
  // cannot prove these are one account" indistinguishable from "we never looked", and the owner
  // read it the second way twice. The card now always appears for two live connections at one bank
  // sharing a last-4, and STATES why it cannot act. So the invariant this test has always been
  // about — that no one-tap combine is offered for a pair whose either direction strands an
  // account — is asserted on the ACTION, which is what a tap would reach, rather than on the
  // presence of the explanation. Found red on clean HEAD during TASKS L.8: #305 shipped
  // verify-green because scripts/verify.sh skips Playwright unless VERIFY_E2E=1.
  await expect(page.getByTestId('combine-connections-confirm')).toHaveCount(0);
  await expect(page.getByTestId('combine-connections-blocked-reason')).toBeVisible();

  // The pair is two connections to ONE provider — the old copy called that "two providers".
  await expect(page.getByTestId('duplicate-pair-why')).toHaveText(
    'Two separate Plaid connections to U.S. Bank both report this account.',
  );
  await expect(page.locator('body')).not.toContainText('two providers');

  // The cost of leaving it alone, and the honest two-step remedy.
  await expect(page.getByTestId('duplicate-pair-impact')).toHaveText(
    'Both are counted right now: $23,800.42 + $23,800.42 = $47,600.84.',
  );
  const howto = await page.getByTestId('duplicate-howto').innerText();
  expect(howto).toContain('two steps');
  expect(howto).toContain('keeps counting');

  // The Bank-sync block numbers the same connections identically, so "connection 1 of 2" is
  // verifiable rather than card-local jargon.
  const statuses = (await texts(page, 'plaid-item-status')).sort();
  expect(statuses).toEqual([
    'Plaid: U.S. Bank · connection 1 of 2 · last synced 2026-07-24',
    'Plaid: U.S. Bank · connection 2 of 2 · last synced 2026-07-24',
  ]);
});

test('arming one side keeps the other side’s evidence on screen', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedTwoUsBankConnections(email);
  await page.goto('/accounts');
  await expect(page.getByTestId('duplicate-accounts-warning')).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId('duplicate-dismiss')).toBeVisible();
  await page.getByTestId('duplicate-resolve-b').click();

  // The confirm lands INSIDE the armed block, so the facts the choice rests on stay visible.
  await expect(page.getByTestId('duplicate-side-b').getByTestId('duplicate-action-confirm-row')).toBeVisible();
  await expect(page.getByTestId('duplicate-side-a').getByTestId('duplicate-side-connection')).toBeVisible();
  await expect(page.getByTestId('duplicate-resolve-b')).toHaveCount(0);
  await expect(page.getByTestId('duplicate-resolve-a')).toHaveCount(1);
  await expect(page.getByTestId('duplicate-action-confirm')).toHaveCount(1);
  const prompt = await page.getByTestId('duplicate-action-confirm-row').innerText();
  expect(prompt).toContain('connection');
  expect(prompt).toContain('keeps counting until you delete it');

  // Dismiss is hidden only while THIS pair is armed, and Escape restores everything.
  await expect(page.getByTestId('duplicate-dismiss')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('duplicate-dismiss')).toBeVisible();
  await expect(page.getByTestId('duplicate-resolve-a')).toHaveCount(1);
  await expect(page.getByTestId('duplicate-resolve-b')).toHaveCount(1);
});

/**
 * Step 2 of the fix, seeded directly: the duplicate loan's connection is already gone (its
 * PlaidItem row was never inserted), which is exactly the state disconnectPlaidItem leaves behind
 * — the Account row survives with a dangling plaidItemId, so syncedDeleteBlockReason clears and
 * the row becomes deletable. Step 1 itself cannot be driven here: /item/remove decrypts the stored
 * access token, and a seeded row's token is not real AES-GCM ciphertext ("Malformed encrypted
 * token"), so the real disconnect needs live Plaid credentials and is out of reach of a seeded e2e.
 */
function seedOrphanedDuplicate(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedOrphanedDuplicate: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const liveItem = `e2e-dup-live-${suffix}`;
    const goneItem = `e2e-dup-gone-${suffix}`; // deliberately NO PlaidItem row
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', 'U.S. Bank', '2026-07-24')`,
    ).run(`e2e-dup-live-row-${suffix}`, uid, liveItem);
    const insAcct = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, ?, ?, ?, 'USD')`,
    );
    insAcct.run(`e2e-dup-keep-${suffix}`, uid, `pl-k-${suffix}`, liveItem, 'Loan - 2927', 'LOAN', '2927', 2380042);
    insAcct.run(`e2e-dup-orphan-${suffix}`, uid, `pl-o-${suffix}`, goneItem, 'Loan - 2927', 'LOAN', '2927', 2380042);
  } finally {
    db.close();
  }
}

test('step 2 — deleting the orphaned copy is what actually stops the double-count', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedOrphanedDuplicate(email);
  await page.goto('/accounts');
  await expect(page.getByTestId('duplicate-accounts-warning')).toBeVisible({ timeout: 20_000 });

  // Both copies still count while only the connection is gone — that is the whole point of the
  // two-step copy: a disconnect on its own changes no number.
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/47,600/);

  // The orphaned side offers Delete and says the row still counts; the live side offers Disconnect.
  const orphanIsA = (await page.getByTestId('duplicate-resolve-a').innerText()).includes('Delete this copy');
  const orphanSide = orphanIsA ? 'duplicate-resolve-a' : 'duplicate-resolve-b';
  const orphanBlock = orphanIsA ? 'duplicate-side-a' : 'duplicate-side-b';
  const liveSide = orphanIsA ? 'duplicate-resolve-b' : 'duplicate-resolve-a';

  await expect(page.getByTestId(orphanBlock).getByTestId('duplicate-side-connection')).toHaveText(
    'Plaid — this copy’s connection is no longer linked. It stopped updating, but it still counts until you delete it.',
  );
  const orphanFace = await page.getByTestId(orphanSide).innerText();
  expect(orphanFace).toContain('Delete this copy');
  expect(orphanFace).toContain('its history goes too');
  expect(await page.getByTestId(liveSide).innerText()).toContain('Disconnect');

  // Delete it — only now does the balance stop counting twice.
  await page.getByTestId(orphanSide).click();
  await expect(page.getByTestId('duplicate-action-confirm-row')).toContainText('The other copy keeps counting');
  await page.getByTestId('duplicate-action-confirm').click();

  await expect(page.getByTestId('duplicate-accounts-warning')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/23,800/);

  // WHICH copy survived, not just how many (critic P2): a net-worth assertion alone would pass if
  // the WRONG row had been deleted, since the two balances are identical. The live connection must
  // still be listed and still feeding its row.
  await expect(page.getByTestId('plaid-connections')).toBeVisible();
  await expect(page.getByTestId('plaid-item-accounts')).toContainText('Loan - 2927 ····2927');
  await expect(page.getByTestId('plaid-item-status')).toHaveCount(1);
});

test('the Bank-sync controls are distinguishable too — the same defect, one section down', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedTwoUsBankConnections(email);
  await page.goto('/accounts');
  await expect(page.getByTestId('plaid-connections')).toBeVisible({ timeout: 20_000 });

  // Two connections to one bank previously produced two "Disconnect U.S. Bank (Plaid)" accessible
  // names — invisible to an axe scan, and the exact thing #296 fixes on the card above.
  for (const testId of ['plaid-disconnect', 'plaid-sync']) {
    const names = await Promise.all(
      (await page.getByTestId(testId).all()).map((b) => b.getAttribute('aria-label')),
    );
    expect(names).toHaveLength(2);
    expect(names.every(Boolean), `${testId} has a control with no accessible name`).toBe(true);
    expect(new Set(names).size, `${testId} controls share an accessible name: ${names.join(' | ')}`).toBe(2);
  }

  // Its confirm prompt now agrees with the duplicate card instead of contradicting it.
  await page.getByTestId('plaid-disconnect').first().click();
  const prompt = await page.getByTestId('plaid-disconnect-confirm-row').innerText();
  expect(prompt).toContain('connection');
  expect(prompt).toContain('keep counting until you delete them');
});

/**
 * TASKS L.10 layer 1 — the door that stops this page needing the card above it.
 *
 * Everything else in this file is about telling an existing duplicate apart. This test is
 * about the duplicate not happening: a user who wants to add an account they didn't share,
 * or to fix a bank that stopped updating, must find a control that reopens the connection
 * they HAVE. Without one the only available move is connecting the same bank again, which
 * mints a second Item and a second copy of every account on it.
 *
 * The Plaid Link window itself is hosted by Plaid and cannot be driven from a browser test
 * (the standing note in plaid-actions.test.ts), so what is locked here is what the page
 * offers and how it reads — not the bank round-trip, which is UNVERIFIED against Plaid.
 */
test('every connection offers a way to add or fix its accounts, distinguishably', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedTwoUsBankConnections(email);
  await page.goto('/accounts');
  await expect(page.getByTestId('plaid-connections')).toBeVisible({ timeout: 20_000 });

  const buttons = await page.getByTestId('plaid-update').all();
  expect(buttons, 'one update control per connection').toHaveLength(2);
  const names = await Promise.all(buttons.map((b) => b.getAttribute('aria-label')));
  expect(names.every(Boolean), 'an update control has no accessible name').toBe(true);
  // Two connections at ONE bank: the accessible names must still differ, or a screen-reader
  // user is choosing blind between two identical-sounding controls (the #296 defect).
  expect(new Set(names).size, `update controls share a name: ${names.join(' | ')}`).toBe(2);
  expect(names.every((n) => n!.includes('U.S. Bank'))).toBe(true);

  // The hint has to appear where the wrong move is otherwise the obvious one.
  const hint = await page.getByTestId('plaid-update-hint').innerText();
  expect(hint).toContain('Add or fix accounts');
  // Re-pointed for L.10 layer 2 rather than deleted: the hint used to warn that re-connecting
  // "makes a second copy of its accounts instead", and the front door now refuses that link, so
  // the old wording became a false threat. What must stay true is that the hint still tells the
  // reader what re-connecting does AND still protects the different-login case from reading as
  // a duplicate (the reason this assertion exists at all).
  expect(hint).toContain('no longer makes a second copy');
  expect(hint).toContain('different login');

  // A third control joined a row that already held two: check the row still fits a phone
  // and the new button is still a real tap target (M.2/M.3 floors).
  await page.setViewportSize({ width: 360, height: 900 });
  const docOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(docOverflow, 'the connections row overflows at 360px').toBeLessThanOrEqual(1);
  const box = await page.getByTestId('plaid-update').first().boundingBox();
  expect(box, 'update control has no box').not.toBeNull();
  expect(box!.height, 'update control is under 44px tall').toBeGreaterThanOrEqual(44);
});

test('the duplicate blocks stay inside the viewport on a phone', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedTwoUsBankConnections(email);
  await page.goto('/accounts');
  await expect(page.getByTestId('duplicate-accounts-warning')).toBeVisible({ timeout: 20_000 });

  for (const width of [360, 393, 430]) {
    await page.setViewportSize({ width, height: 900 });
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(docOverflow, `document overflows at ${width}px`).toBeLessThanOrEqual(1);

    // The document gate is blind to bleed smaller than the shell's 16px gutter, so check the
    // new blocks and controls individually too.
    for (const id of [
      'duplicate-side-a',
      'duplicate-side-b',
      'duplicate-resolve-a',
      'duplicate-resolve-b',
      'duplicate-dismiss',
    ]) {
      const bleed = await page
        .getByTestId(id)
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(bleed, `${id} overflows at ${width}px`).toBeLessThanOrEqual(1);
    }
  }

  // Every control stays a real tap target at the smallest width.
  await page.setViewportSize({ width: 360, height: 900 });
  for (const id of ['duplicate-resolve-a', 'duplicate-resolve-b', 'duplicate-dismiss']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, `${id} has no box`).not.toBeNull();
    expect(box!.height, `${id} is under 44px tall`).toBeGreaterThanOrEqual(44);
  }
});

/**
 * TASKS L.6 — the same disease on /cards, where it costs money.
 *
 * The owner's screenshot of 2026-07-24: one real Chase card on two live Plaid connections rendered
 * TWO entries — both named `CREDIT CARD`, both $6,679.68, both $66.00 minimum, both Aug 5 — and
 * both emitted a full obligation, so the "Do this first" instruction and every card total carried
 * +$6,679.68 that he does not owe. The page flagged nothing: `cashNeededFromSnapshot` strips only
 * RECONCILED rows, and the personal duplicate detector rendered only on /accounts.
 */
function seedDuplicateCardOnTwoConnections(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedDuplicateCardOnTwoConnections: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const insItem = db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', 'Chase', '2026-07-24')`,
    );
    insItem.run(`e2e-l6-item-row-a-${suffix}`, uid, `e2e-l6-item-a-${suffix}`);
    insItem.run(`e2e-l6-item-row-b-${suffix}`, uid, `e2e-l6-item-b-${suffix}`);
    // Both cycle days are set on purpose: #277's cycle-2 counter-lock refuses to date a card from a
    // due day alone, so without an anchor these would land in "No due date yet" and never reach the
    // totals the disclosure is about.
    const insAcct = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask,
                            currentBalanceCents, currency, dueDayOfMonth, cycleCloseDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CREDIT', ?, ?, 'USD', 5, 8)`,
    );
    insAcct.run(`e2e-l6-card-a-${suffix}`, uid, `pl-l6a-${suffix}`, `e2e-l6-item-a-${suffix}`, 'CREDIT CARD', '0977', -667968);
    insAcct.run(`e2e-l6-card-b-${suffix}`, uid, `pl-l6b-${suffix}`, `e2e-l6-item-b-${suffix}`, 'CREDIT CARD', '0977', -667968);
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask,
                            currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '4411', 500000, 'USD')`,
    ).run(`e2e-l6-chk-${suffix}`, uid, `pl-l6c-${suffix}`, `e2e-l6-item-a-${suffix}`);
    // The issuer statement each side carries — his real figures. Without one the engine estimates
    // a $0 statement and the disclosure would quote $0.00 twice, which proves nothing about the
    // double-count it exists to disclose.
    const insStmt = db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents,
                              minimumPaymentCents, isEstimated)
       VALUES (?, ?, '2026-07-09', '2026-08-08', '2026-09-05', 667968, 6600, 0)`,
    );
    insStmt.run(`e2e-l6-stmt-a-${suffix}`, `e2e-l6-card-a-${suffix}`);
    insStmt.run(`e2e-l6-stmt-b-${suffix}`, `e2e-l6-card-b-${suffix}`);
  } finally {
    db.close();
  }
}

/**
 * TASKS L.15 (a) — the cash-flow calendar was the sixth silent surface.
 *
 * `buildCashFlowCalendar` emits one event per obligation, so a card arriving through two live
 * connections puts TWO due events on the grid and inflates both figures the month summary prints:
 * the money going out, and the count of payments due. The page said nothing.
 *
 * FAIL-OLD: `cards-duplicate` did not exist on /calendar before this change.
 *
 * Uses the same fixture as the /cards test above — one real Chase card, two live Plaid items,
 * a real issuer statement on each side — and pages to the month that statement is due in.
 */
test('the calendar discloses two due events for what may be one card', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedDuplicateCardOnTwoConnections(email);
  // The seeded statements are due 2026-09-05, so that is the month whose grid carries both events.
  await page.goto('/calendar?month=2026-09');

  const warning = page.getByTestId('cards-duplicate');
  await expect(warning).toBeVisible({ timeout: 20_000 });
  const text = (await warning.innerText()).replace(/\s+/g, ' ');

  // It names the two figures THIS surface states — never "the total above", which the calendar
  // does not print.
  expect(text).toContain('money-out total');
  expect(text).toContain('count of payments due');
  // The basis is stated inline, not asserted bare.
  expect(text).toContain('Likely — matched on');
  // Disclose, never adjust: both events are still on the grid, and the copy says so.
  expect(text).toContain('has been adjusted');
  expect(text).toContain('only you can confirm');

  // And both events really are still painted — the disclosure did not remove one.
  const due = page.getByTestId('calendar-list').getByText(/CREDIT CARD due/);
  expect(await due.count()).toBe(2);
});

test('/cards discloses a card counted twice, and names which two entries', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedDuplicateCardOnTwoConnections(email);
  await page.goto('/cards');

  const warning = page.getByTestId('cards-duplicate');
  await expect(warning).toBeVisible({ timeout: 20_000 });
  const text = (await warning.innerText()).replace(/\s+/g, ' ');

  // It says the thing the page previously left silent: both rows are in this cycle's total.
  // Both carry a REAL statement here, so both are genuinely inside headline.requiredCents —
  // the only state in which this sentence is true (see the estimated/paid-off unit cases).
  expect(text).toContain("this cycle's figures include both");
  expect(text).toContain('$6,679.68');
  // The basis is stated inline rather than asserted bare above a payment instruction.
  expect(text).toContain('Likely — matched on');
  // …and it does NOT quietly subtract one. Disclose, never adjust (DECISIONS #289).
  expect(text).toContain('No figure above has been adjusted');
  expect(text).toContain('only you can confirm');

  // Naming both entries is the whole point — "CREDIT CARD" alone identifies neither.
  const headings = (await page.getByTestId(/^card-identity-/).allInnerTexts()).map((t) => t.trim());
  expect(headings).toHaveLength(2);
  expect(headings[0]).not.toBe(headings[1]);
  for (const h of headings) expect(text).toContain(h);
});

/**
 * The cross-section half of the identity guarantee (#298, extended for TASKS L.6).
 *
 * #298 computed card identities in TWO passes — one for the dated grid, one for the "No due date
 * yet" panel — so each guaranteed distinctness only WITHIN itself. A dated card and an undated card
 * sharing a name, with no last-4 between them, therefore painted two identical headings. That is
 * the state the whole #296/#297/#298 line of work exists to prevent, and the L.6 disclosure names
 * cards by exactly these headings. One pass over the whole displayed list restores it.
 */
function seedSameNameDatedAndUndated(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedSameNameDatedAndUndated: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', 'Chase', '2026-07-24')`,
    ).run(`e2e-xid-item-row-${suffix}`, uid, `e2e-xid-item-${suffix}`);
    // Deliberately NO mask on either row — a manual/thin feed is exactly when the numbering
    // fallback has to carry the identity on its own.
    const insAcct = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask,
                            currentBalanceCents, currency, dueDayOfMonth, cycleCloseDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, 'CREDIT CARD', 'CREDIT', NULL, ?, 'USD', ?, ?)`,
    );
    // Dated: both cycle days present ⇒ a real obligation in the grid.
    insAcct.run(`e2e-xid-dated-${suffix}`, uid, `pl-xd-${suffix}`, `e2e-xid-item-${suffix}`, -120000, 5, 8);
    // Undated: no cycle days at all ⇒ the "No due date yet" panel (#277's counter-lock).
    insAcct.run(`e2e-xid-undated-${suffix}`, uid, `pl-xu-${suffix}`, `e2e-xid-item-${suffix}`, -45000, null, null);
  } finally {
    db.close();
  }
}

test('a dated card and an undated card with the same name are still told apart', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedSameNameDatedAndUndated(email);
  await page.goto('/cards');

  await expect(page.getByTestId('cards-unknown-due')).toBeVisible({ timeout: 20_000 });
  // Neither row has a last-4, so the identity falls back to the positional marker — and the two
  // sections are numbered as ONE list running down the page. The pre-fix build numbered each list
  // from 1 independently, so both rows read "1. no card number on file" and the page contained no
  // "2." at all. The undated panel prints its identity as plain text, so assert on rendered copy.
  const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(body).toContain('1. no card number on file');
  expect(body).toContain('2. no card number on file');
});
