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
 * Two live U.S. Bank Plaid connections. Connection A feeds the loan AND a credit card;
 * connection B feeds only its copy of the loan. Both loan rows carry the same mask and the same
 * balance, so the #192 detector flags them 'high' on mask + identical balance.
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

  // The blast radius is on the button FACE, before the tap that needs it.
  const bothFaces = `${faceA}\n${faceB}`;
  expect(bothFaces).toContain('2 accounts stop updating');
  expect(bothFaces).toContain('1 account stops updating');

  // Which connection each row sits on, numbered the same way in both places on the page.
  const connectionLines = (await texts(page, 'duplicate-side-connection')).sort();
  expect(connectionLines).toEqual([
    'Plaid: U.S. Bank · connection 1 of 2 · last synced 2026-07-24',
    'Plaid: U.S. Bank · connection 2 of 2 · last synced 2026-07-24',
  ]);

  // What each connection carries — visible without arming anything.
  const feeds = (await texts(page, 'duplicate-side-feeds')).sort();
  expect(feeds).toEqual(['Also feeds 1 other account: CREDIT CARD ····0977', 'Feeds only this account.']);

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
