/**
 * Marking one transaction as recurring by hand, and taking it back (TASKS O.13f /
 * O.15 slice 4) — SIMPLIFI_PARITY row 12.
 *
 * The gap this closes: detection needs THREE charges a steady time apart before it
 * will call anything recurring. That bar is right for a guess and useless for the
 * reader, who knows after ONE charge that his rent is monthly — and who can also
 * see, on /recurring, a "bill" the detector assembled out of coincidences and had
 * no way to argue with.
 *
 * The spec is built so neither half can pass by accident:
 *
 *  - it enters exactly ONE charge, so /recurring is provably empty first. A
 *    feature that merely re-displayed a detected series would fail at that line.
 *  - after the declaration it checks the /calendar, which reads STORED projection
 *    rows and never detects anything itself. That is the assertion that would have
 *    caught the half-applied version of this feature, where the page the reader is
 *    standing on agrees with him and the cash surfaces do not.
 */
import { expect, test, type Page } from './helpers/test';

const RENT = { descriptor: 'LAKESIDE PROPERTY MGMT RENT', amount: '1250.00' };

async function signUpThrowaway(page: Page) {
  const email = `e2e-rcv-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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
  await page.getByTestId('manual-value').fill('5000');
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

test('one charge, declared recurring by hand, reaches the pages that project money — and the undo removes it everywhere', async ({
  page,
}) => {
  // Flake ledger run 31366324555: the markRecurring server action's router.push
  // navigation stalled >20s under 4-worker shared-SQLite load (the ≥60s
  // server-action stall class documented at playwright.config:31) — the page
  // snapshot at timeout shows a healthy /transactions with the action menu open,
  // waiting on the navigation that never arrived. The 90s waitForURL below is
  // only reachable if the test itself outlives it, so the per-test timeout is
  // required — the established mobile-overflow / transactions.spec.ts:638 idiom.
  test.setTimeout(240_000);
  await signUpThrowaway(page);
  await addManualAccount(page, 'RCV Checking');
  await addPurchase(page, RENT.descriptor, RENT.amount);

  // PRECONDITION, measured rather than assumed: one charge is not a pattern, so
  // the app says nothing about it. Everything below is therefore the reader's
  // instruction taking effect, not a detection that was there all along.
  await page.goto('/recurring');
  await expect(page.getByTestId('recurring-row')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByTestId('recurring-instructions')).toHaveCount(0);

  // THE GESTURE: from the row he is looking at, through the one action menu.
  await page.goto('/transactions');
  const rentRow = page.getByTestId('txn-row').filter({ hasText: /1,250\.00/ });
  await expect(rentRow).toBeVisible({ timeout: 20000 });
  await expect(async () => {
    await rentRow.getByTestId('txn-action-trigger').click({ timeout: 2000 });
    await expect(page.getByTestId('txn-action-markRecurring')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('txn-action-markRecurring').click();
  // Window raised 20s → 90s (flake ledger run 31366324555): the server action's
  // router.push navigation stalled past a 20s window under 4-worker shared-SQLite
  // load — the ≥60s stall class documented at playwright.config:31, same
  // signature as the transactions.spec.ts:638 failures. 90s rides out the
  // documented stall; a real defect (no navigation, error toast) still times out.
  await page.waitForURL('**/transactions/**', { timeout: 90000 });

  // The picker offers only rhythms the engine will actually project.
  const cadence = page.getByTestId('detail-recurring-cadence');
  await expect(cadence).toBeVisible({ timeout: 20000 });
  await expect(cadence.locator('option')).toHaveCount(6);
  await cadence.selectOption('MONTHLY');
  await page.getByTestId('detail-recurring-save').click();

  // Saved, and the page now states what is in force rather than offering it again.
  await expect(page.getByTestId('detail-recurring-state')).toContainText('every month', {
    timeout: 20000,
  });

  // IT REACHED THE PAGE THAT LISTS RECURRING — as the reader's own call, badged,
  // never as a pattern the app claims to have observed.
  await page.goto('/recurring');
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Lakeside' });
  await expect(row).toHaveCount(1, { timeout: 20000 });
  await expect(row.getByTestId('recurring-declared-badge')).toBeVisible();
  await expect(page.getByTestId('recurring-instruction')).toHaveCount(1);

  // AND IT REACHED THE MONEY. /calendar reads STORED projection rows written by
  // the refresh the save triggered; it never detects anything itself, so this
  // fails outright if the verdict stopped at the page above.
  //
  // NEXT month, not this one, and that is arithmetic rather than a workaround:
  // the entry form dates a new charge TODAY, so the first monthly occurrence
  // after it is one month out. Reached by the page's own control, so the test
  // never has to name a month and cannot rot when the clock moves.
  await page.goto('/calendar');
  await page.getByTestId('cal-next').click();
  await expect(page.getByText(/Lakeside/i).first()).toBeVisible({ timeout: 20000 });

  // THE UNDO, from the list of standing instructions — the only surface a demoted
  // series could ever be recovered from, and the same one that undoes this.
  await page.goto('/recurring');
  await page.getByTestId('recurring-instruction-undo').first().click();
  await expect(page.getByTestId('recurring-row')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByTestId('recurring-instructions')).toHaveCount(0);
  // Back to what the charges themselves say, on the cash surface too.
  await page.goto('/calendar');
  await page.getByTestId('cal-next').click();
  await expect(page.getByText(/Lakeside/i)).toHaveCount(0, { timeout: 20000 });
});
