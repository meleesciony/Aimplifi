/**
 * O.13g / O.15 slice 7 — "Pending / Cleared, editable by the reader"
 * (Simplifi parity row 13: `status` rendered as a badge with no action behind it).
 *
 * Two facts the unit tests structurally cannot reach, because both are about
 * what is ON SCREEN for a real row:
 *
 *  1. On a row the READER entered, the control exists and the flip survives a
 *     reload — plus the register's money-out is UNCHANGED by it. That last
 *     assertion is the counter-intuitive half of the disclosure and the reason
 *     it is worth an e2e: `isSpendRow` does not read `status`, so marking a row
 *     pending must NOT move the category/register totals. A slice that quietly
 *     made status a spending gate would pass every availability test and fail
 *     here.
 *  2. On a row the BANK owns, the same menu entry is present and disabled with
 *     its reason — never hidden. The demo dataset is the reachable bank-owned
 *     population (its rows present as a feed), and it is also fenced against
 *     writes, so this is the refusal rendered exactly where a reader meets it.
 */
import { expect, test, type Page } from './helpers/test';

const PURCHASE = { descriptor: 'HOME DEPOT 4021', amount: '148.90' };
/** A second row so money-out is never just the row under test. */
const OTHER = { descriptor: 'Lakeshore Learning Mater', amount: '18.65' };

async function signUpThrowaway(page: Page) {
  const email = `e2e-status-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

async function addManualAccount(page: Page, name: string) {
  await page.goto('/accounts');
  // The first click after a load can land pre-hydration and drop silently (#167).
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill(name);
  await page.getByTestId('manual-type').selectOption('CHECKING');
  await page.getByTestId('manual-value').fill('2500');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: name })).toBeVisible({
    timeout: 20000,
  });
}

async function addPurchase(page: Page, descriptor: string, amount: string) {
  await page.goto('/transactions/new');
  await expect(async () => {
    await page.getByTestId('txn-descriptor').fill(descriptor, { timeout: 2000 });
    await expect(page.getByTestId('txn-descriptor')).toHaveValue(descriptor, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('txn-amount').fill(amount);
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions', { timeout: 20000 });
}

test('a transaction you entered can be marked pending, and says what that does', async ({ page }) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'Status Checking');
  await addPurchase(page, PURCHASE.descriptor, PURCHASE.amount);
  await addPurchase(page, OTHER.descriptor, OTHER.amount);

  await page.goto('/transactions');
  // Read the register's own figure BEFORE the flip; hardcoding it would test the
  // fixture rather than the invariant.
  const outBefore = await page.getByTestId('summary-out').innerText();

  const row = page.getByTestId('txn-row').filter({ hasText: /148\.90/ });
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.getByTestId('txn-detail-link').click();
  await page.waitForURL(/\/transactions\/[a-z0-9]{20,}/, { timeout: 20000 });
  const detailUrl = page.url();

  // Manual entry always writes POSTED, so this is the shipped starting state.
  await expect(page.getByTestId('detail-status-value')).toHaveText('Cleared', { timeout: 20000 });
  // The effect sentence is on screen BEFORE the press, not after it — the reader
  // is told what the control does while he can still not press it. That means it
  // renders beside a CLEARED row too, so it must be phrased definitionally
  // ("Pending means …") and must never assert this row is currently pending.
  await expect(page.getByTestId('detail-status-effect')).toContainText('Pending means', {
    timeout: 20000,
  });

  // The control the parity matrix called MISSING.
  const toggle = page.getByTestId('detail-status-toggle');
  await expect(toggle).toHaveText('Mark as pending', { timeout: 20000 });
  await expect(async () => {
    await toggle.click({ timeout: 2000 });
    await expect(page.getByTestId('detail-status-value')).toHaveText('Pending', { timeout: 4000 });
  }).toPass({ timeout: 30000 });

  // It survives a reload — the server wrote it, not just the DOM.
  await page.goto(detailUrl);
  await expect(page.getByTestId('detail-status-value')).toHaveText('Pending', { timeout: 20000 });
  // …and now the money sentence is on screen, naming the surfaces that drop it.
  await expect(page.getByTestId('detail-status-effect')).toContainText('has not settled yet', {
    timeout: 20000,
  });
  await expect(page.getByTestId('detail-status-effect')).toContainText('the tax export');
  // The toggle has turned around, so the reader is never stranded in pending.
  await expect(page.getByTestId('detail-status-toggle')).toHaveText('Mark as cleared');

  // THE COUNTER-INTUITIVE HALF: /reports and the register count a pending row
  // exactly like a cleared one (`isSpendRow` never reads status), which is what
  // the disclosure claims. If a future change makes status a spending gate, this
  // fails and the sentence must be rewritten.
  await page.goto('/transactions');
  await expect(page.getByTestId('summary-out')).toHaveText(outBefore, { timeout: 20000 });
});

test('a transaction the bank owns shows the refusal, not a control', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.getByTestId('txn-detail-link').click();
  // The demo seed's ids are `txn-00846`, not cuids, so this matches an id of any
  // shape while still excluding the two static sibling routes.
  // O.16 attaches `?back=` to every register detail link (links.ts — place from
  // Activity rides it), so the id may be followed by a query string. This spec
  // predated that param and pinned the URL to END at the id, which broke all
  // three of its detail navigations on main — found when K.1's full-verify ran
  // the whole suite (proven pre-existing: same 3 failures on a stashed tree).
  await page.waitForURL(/\/transactions\/(?!(?:new|import)(?:\?|$))[a-z0-9-]+(?:\?.*)?$/, { timeout: 20000 });

  // Disabled WITH its reason, never hidden — the rule the whole action menu follows.
  await expect(page.getByTestId('detail-status-toggle')).toHaveCount(0);
  await expect(page.getByTestId('detail-status-reason')).toContainText(
    'whether it has cleared is the bank',
    { timeout: 20000 },
  );
});

/**
 * The register must not be able to fire this action without the sentence. Both
 * critics found that it could: the menu item was a bare button, so a tax-tagged
 * row could leave the tax export in one click with nothing on screen. It now
 * navigates to the detail view, where the control and its disclosure sit together
 * — the same arrangement `split` and `markRecurring` already use.
 */
test('the register sends you to the detail view rather than flipping status in place', async ({
  page,
}) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'Register Status Checking');
  await addPurchase(page, PURCHASE.descriptor, PURCHASE.amount);

  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').filter({ hasText: /148\.90/ });
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(async () => {
    await row.getByTestId('txn-action-trigger').click({ timeout: 2000 });
    await expect(row.getByTestId('txn-action-status')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });

  const item = row.getByTestId('txn-action-status');
  await expect(item).toHaveText('Mark as pending');
  // A link, not a button: the write cannot happen from here at all. (`?back=`
  // is O.16's return-context — same reason as the waitForURL below.)
  await expect(item).toHaveAttribute('href', /\/transactions\/[a-z0-9-]+(?:\?.*)?$/);
  await item.click();
  // O.16 attaches `?back=` to every register detail link (links.ts — place from
  // Activity rides it), so the id may be followed by a query string. This spec
  // predated that param and pinned the URL to END at the id, which broke all
  // three of its detail navigations on main — found when K.1's full-verify ran
  // the whole suite (proven pre-existing: same 3 failures on a stashed tree).
  await page.waitForURL(/\/transactions\/(?!(?:new|import)(?:\?|$))[a-z0-9-]+(?:\?.*)?$/, { timeout: 20000 });
  // …and the reader lands where the sentence is.
  await expect(page.getByTestId('detail-status-effect')).toContainText('Pending means', {
    timeout: 20000,
  });
  await expect(page.getByTestId('detail-status-toggle')).toBeVisible();
});

/**
 * The tax caution had no test at all (critic B, P2): it could have been deleted
 * and every suite stayed green. It is the slice-6 "two orders" guard — a tagged
 * row going pending silently leaves a figure bound for a preparer.
 */
test('a tax-tagged row warns that going pending drops it from the tax export', async ({ page }) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'Tax Status Checking');
  await addPurchase(page, 'CVS PHARMACY 8871', '64.10');

  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').filter({ hasText: /64\.10/ });
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.getByTestId('txn-detail-link').click();
  // O.16 attaches `?back=` to every register detail link (links.ts — place from
  // Activity rides it), so the id may be followed by a query string. This spec
  // predated that param and pinned the URL to END at the id, which broke all
  // three of its detail navigations on main — found when K.1's full-verify ran
  // the whole suite (proven pre-existing: same 3 failures on a stashed tree).
  await page.waitForURL(/\/transactions\/(?!(?:new|import)(?:\?|$))[a-z0-9-]+(?:\?.*)?$/, { timeout: 20000 });

  // Untagged: the effect sentence is there, the tax clause is NOT — or the caution
  // would be permanent furniture rather than a warning about this row.
  await expect(page.getByTestId('detail-status-effect')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('detail-status-tax-caution')).toHaveCount(0);

  await expect(async () => {
    await page.getByTestId('detail-tax').selectOption('medical', { timeout: 3000 });
    await expect(page.getByTestId('detail-tax')).toHaveValue('medical', { timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('detail-note-save').click();

  await expect(page.getByTestId('detail-status-tax-caution')).toContainText('tax export', {
    timeout: 30000,
  });
});
