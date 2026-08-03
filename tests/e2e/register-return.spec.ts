/**
 * O.16 — the reader comes back to where he was.
 *
 * Owner, 2026-07-30: *"Can you add away to go back to what we were doing after
 * let's say changing a rule? Right now I have to click activity again and needs
 * category"*.
 *
 * WHY AN E2E AND NOT ONLY THE UNIT LOCK: `register-return.test.ts` proves the
 * builder and the decoder agree, which is a fact about two strings. It cannot
 * see whether the affordance is ON THE PAGE, and this repo has the scar for
 * exactly that gap — O.13b shipped a banner that typechecked, built and passed
 * 225 e2e tests while rendering nothing, because a server component imported a
 * constant from a `'use client'` module and got a reference stub. The rules page
 * IS a server component reading a param, so only a rendered-page assertion can
 * tell us the link exists.
 *
 * WHY A THROWAWAY USER PER TEST, and not the demo. The first draft signed in as
 * the demo and read its "Needs a category" queue. It passed alone and FAILED
 * three-of-four under the full suite with `element(s) not found` — the demo is
 * one shared row, and the specs that file transactions drain that queue before
 * this one reads it. That is the documented order-dependency
 * (`a-passive-gate-cannot-see-what-fits-in-the-gutter`), not the rotating
 * environment flake, and the prescription there is exactly this: seed your own
 * user, and ASSERT THE FIXTURE'S HARD CASE IS PRESENT so the lock cannot quietly
 * degrade into measuring an empty page.
 *
 * The negative case is not decoration. A "Back to…" link that renders no matter
 * where the reader came from would pass every positive assertion here while
 * making a false claim about his own history on the visits that arrive from the
 * nav — so the unfiltered case asserting ABSENCE is what stops the affordance
 * from degrading into furniture.
 */
import { expect, test, type Page } from './helpers/test';

/**
 * A payee no merchant map can place, so "Auto-detect" leaves it needing a
 * category and the row is guaranteed to be in the queue under test. A
 * recognisable name (the sibling spec's COSTCO) would be filed automatically and
 * never appear.
 */
const UNFILED = { descriptor: 'ZZQ VENDOR 4471 NONESUCH', amount: '41.20' };

/** The owner's own queue: Activity filtered to "Needs a category". */
const QUEUE = '/transactions?unclassified=1';

async function signUpThrowaway(page: Page) {
  const email = `e2e-o16-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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

/** A reader standing in the "Needs a category" queue with one row in it. */
async function readerInTheQueue(page: Page) {
  await signUpThrowaway(page);
  await addManualAccount(page, 'O16 Checking');
  await addPurchase(page, UNFILED.descriptor, UNFILED.amount);
  await page.goto(QUEUE);
  // The fixture's hard case, asserted rather than assumed: if auto-detect ever
  // learns this payee the queue goes empty and every assertion below would pass
  // vacuously against a page with no rows.
  await expect(page.getByTestId('txn-row').filter({ hasText: 'Zzq' })).toBeVisible({
    timeout: 20000,
  });
}

test.describe('O.16 — carrying the place the reader was standing in', () => {
  test('a rule opened from the filtered queue offers the queue back', async ({ page }) => {
    await readerInTheQueue(page);

    await page.getByTestId('txn-rule-link').first().click();
    await page.waitForURL('**/rules?**', { timeout: 20000 });

    // `?from=` and `?back=` share a query string, and the register spells a DATE
    // bound `from=` while /rules spells a transaction `from=`. If those ever
    // collide the builder silently loses the row it was opened for.
    const url = new URL(page.url());
    expect(url.searchParams.get('from')).toBeTruthy();
    expect(url.searchParams.get('back')).toBe('unclassified=1');

    // Named, not generic: this is the view he actually left.
    const back = page.getByTestId('rules-return-link');
    await expect(back).toBeVisible({ timeout: 20000 });
    await expect(back).toHaveText(/Return to Needs a category/);

    await back.click();
    await page.waitForURL('**/transactions?**', { timeout: 20000 });
    expect(new URL(page.url()).searchParams.get('unclassified')).toBe('1');
  });

  test('a row action that lands on the detail view returns to the queue too', async ({ page }) => {
    // Split, "Recurring…" and the status control all navigate here from the
    // register, and this link was a bare /transactions before O.16.
    await readerInTheQueue(page);

    await page.getByTestId('txn-detail-link').first().click();
    await page.waitForURL('**/transactions/**', { timeout: 20000 });

    const back = page.getByTestId('detail-back-link');
    await expect(back).toBeVisible({ timeout: 20000 });
    await expect(back).toHaveText(/Back to Needs a category/);
    await back.click();
    await page.waitForURL('**/transactions?**', { timeout: 20000 });
    expect(new URL(page.url()).searchParams.get('unclassified')).toBe('1');
  });

  test('still offers Return to the transaction when he narrowed nothing', async ({ page }) => {
    await signUpThrowaway(page);
    await addManualAccount(page, 'O16 Checking');
    await addPurchase(page, UNFILED.descriptor, UNFILED.amount);

    await page.goto('/transactions');
    await page.getByTestId('txn-rule-link').first().click();
    await page.waitForURL('**/rules?**', { timeout: 20000 });

    // No register filters to restore — but `?from=` still names the row he left,
    // so Return must not dump him into a cold Activity list to start over.
    expect(new URL(page.url()).searchParams.get('back')).toBeNull();
    const from = new URL(page.url()).searchParams.get('from');
    expect(from).toBeTruthy();
    const back = page.getByTestId('rules-return-link');
    await expect(back).toBeVisible({ timeout: 20000 });
    await expect(back).toHaveText(/Return to the transaction you were on/);
    await back.click();
    await page.waitForURL(`**/transactions/${from}`, { timeout: 20000 });
  });
});
