/**
 * C.15 (audit F1/F2/F3) — the return affordance one hop deeper: a TRANSACTION
 * or a named page as the destination.
 *
 * Owner, 2026-08-02: "user experience also seems quite clunky". The audit found
 * the return affordance lossy in exactly the four places these tests walk:
 *   - F2: the split-parent link on a split child's detail page was BARE — it
 *     offered "Back to Activity" and threw away the reader's place at the
 *     second hop.
 *   - F3: triage, the dashboard recents, and the breakdown expanders all
 *     handed the detail page NO context, so its way back always said
 *     "Activity" instead of naming where the reader actually stood.
 *
 * WHY AN E2E AND NOT ONLY THE UNIT LOCK: `transaction-return.test.ts` proves
 * the encoders and decoders agree, which is a fact about strings. It cannot
 * see whether the affordance is ON THE PAGE, and this repo has the scar for
 * exactly that gap — O.13b shipped a banner that typechecked, built and passed
 * 225 e2e tests while rendering nothing. Every assertion below is a rendered
 * link, its text, and where a real click lands.
 *
 * WHY A THROWAWAY USER PER TEST, and not the demo — the same prescription as
 * the O.16 lock: the demo is one shared row that other specs drain, so each
 * test seeds its own user and asserts the fixture's hard case is present
 * (the queue has the row; the split has children) so a lock cannot quietly
 * degrade into measuring an empty page.
 */
import { expect, test, type Page } from './helpers/test';

/** A payee no merchant map can place, so it stays in the triage queue. */
const UNFILED = { descriptor: 'ZZQ VENDOR 4471 NONESUCH', amount: '41.20' };
/** A recognisable payee that auto-files, so the register has a filed row. */
const FILED = { descriptor: 'COSTCO WHSE 1084', amount: '212.40' };
const OTHER = { descriptor: 'Lakeshore Learning Mater', amount: '18.65' };

async function signUpThrowaway(page: Page) {
  const email = `e2e-c15-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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

/** Opens the detail page of the register row whose amount matches, without
 *  guessing the register's sort order. */
async function openRowDetail(page: Page, amount: string) {
  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').filter({ hasText: new RegExp(amount) });
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.getByTestId('txn-detail-link').click();
  await page.waitForURL(/\/transactions\/[a-z0-9]{20,}/, { timeout: 20000 });
}

async function fileAs(page: Page, category: string) {
  await page.getByTestId('detail-category-select').selectOption(category);
  await page.getByTestId('detail-category-save').click();
  // Wait on a fact only the SERVER can produce after the write — the provenance
  // badge flipping to "You set this". Asserting the select's own value instead
  // would pass against the pre-reload DOM (the O.13b lesson, measured).
  await expect(page.getByText('You set this')).toBeVisible({ timeout: 30000 });
}

/** Splits the row the detail page is showing into two filed parts. */
async function splitOnDetail(page: Page) {
  await page.getByTestId('detail-split-open').click();
  await page.getByTestId('detail-split-amount').fill('12.40');
  await page.getByTestId('detail-split-first-cat').selectOption('household');
  await page.getByTestId('detail-split-second-cat').selectOption('shopping');
  await page.getByTestId('detail-split-confirm').click();
  await expect(page.getByTestId('detail-split-parts').locator('li')).toHaveCount(2, {
    timeout: 20000,
  });
}

test.describe('C.15 — the reader\'s place survives the hop INTO a transaction', () => {
  test('the triage inbox hands its queue to the detail page (F3)', async ({ page }) => {
    await signUpThrowaway(page);
    await addManualAccount(page, 'C15 Checking');
    await addPurchase(page, UNFILED.descriptor, UNFILED.amount);

    await page.goto('/triage');
    // The fixture's hard case: one unfiled merchant must be sitting in the queue.
    await expect(page.getByTestId('triage-open-detail')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('triage-open-detail').click();
    await page.waitForURL(/\/transactions\/[a-z0-9]{20,}/, { timeout: 20000 });
    // The named-page token is what this entry point promised to carry.
    expect(new URL(page.url()).searchParams.get('back')).toBe('_triage');

    const back = page.getByTestId('detail-back-link');
    await expect(back).toBeVisible({ timeout: 20000 });
    await expect(back).toHaveText(/Back to the triage inbox/);
    await back.click();
    await page.waitForURL('**/triage', { timeout: 20000 });
    expect(new URL(page.url()).pathname).toBe('/triage');
  });

  test('the dashboard recents hand their place over, and the split-parent link keeps it (F3 + F2)', async ({
    page,
  }) => {
    await signUpThrowaway(page);
    await addManualAccount(page, 'C15 Checking');
    await addPurchase(page, FILED.descriptor, FILED.amount);
    await addPurchase(page, OTHER.descriptor, OTHER.amount);

    await openRowDetail(page, '212\\.40');
    await fileAs(page, 'household');
    await splitOnDetail(page);

    // The split made children; the dashboard recents now list them.
    await page.goto('/dashboard');
    const partRow = page.getByTestId('dashboard-recent-row').filter({ hasText: /12\.40/ });
    await expect(partRow).toBeVisible({ timeout: 20000 });

    // F3: the dashboard hands its OWN place to the child's detail page.
    await partRow.click();
    await page.waitForURL(/\/transactions\/[a-z0-9]{20,}/, { timeout: 20000 });
    expect(new URL(page.url()).searchParams.get('back')).toBe('_dashboard');
    await expect(page.getByTestId('detail-back-link')).toHaveText(/Back to your dashboard/, {
      timeout: 20000,
    });

    // F2: the split-parent link is NOT bare — it rides forward the same place.
    const parentLink = page.getByTestId('detail-split-parent-link');
    await expect(parentLink).toBeVisible({ timeout: 20000 });
    const parentHref = await parentLink.getAttribute('href');
    expect(parentHref).not.toBeNull();
    const parentUrl = new URL(parentHref!, 'http://127.0.0.1:3100');
    expect(parentUrl.searchParams.get('back')).toBe('_dashboard');

    // The parent (undo screen) then offers the dashboard back, not Activity.
    await parentLink.click();
    await page.waitForURL(/\/transactions\/[a-z0-9]{20,}/, { timeout: 20000 });
    const back = page.getByTestId('detail-back-link');
    await expect(back).toHaveText(/Back to your dashboard/, { timeout: 20000 });
    await back.click();
    await page.waitForURL('**/dashboard', { timeout: 20000 });
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('a breakdown expander on /budgets hands the page over (F3)', async ({ page }) => {
    await signUpThrowaway(page);
    await addManualAccount(page, 'C15 Checking');
    await addPurchase(page, FILED.descriptor, FILED.amount);

    await openRowDetail(page, '212\\.40');
    await fileAs(page, 'household');

    await page.goto('/budgets');
    // /budgets names its panels `budget-breakdown-*` (its own testIdPrefix);
    // the shared component's default prefix is used by other hosts.
    const toggle = page.getByTestId('budget-breakdown-toggle-household');
    await expect(toggle).toBeVisible({ timeout: 20000 });
    await toggle.click();

    const rows = page.getByTestId('budget-breakdown-rows-household');
    await expect(rows).toBeVisible({ timeout: 20000 });
    const rowLink = rows.getByRole('link').first();
    await expect(rowLink).toBeVisible({ timeout: 20000 });

    await rowLink.click();
    await page.waitForURL(/\/transactions\/[a-z0-9]{20,}/, { timeout: 20000 });
    // /budgets carries no query of its own, so the token is bare.
    expect(new URL(page.url()).searchParams.get('back')).toBe('_budgets');

    const back = page.getByTestId('detail-back-link');
    await expect(back).toBeVisible({ timeout: 20000 });
    await expect(back).toHaveText(/Back to your budget/);
    await back.click();
    await page.waitForURL('**/budgets', { timeout: 20000 });
    expect(new URL(page.url()).pathname).toBe('/budgets');
  });
});
