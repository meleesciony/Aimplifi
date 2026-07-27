/**
 * PWA service worker (#166, supersedes the ROADMAP #5 offline shell): the SW
 * registers and CONTROLS the page, and — the regression this spec exists for —
 * a server action still round-trips UNDER that controlling SW.
 *
 * History: the v1/v2 SW's fetch listener intermittently aborted streamed
 * server-action POST responses (net::ERR_ABORTED after a 200) in Chromium AND
 * branded Chrome, so useActionState never resolved: buttons wedged at
 * "Setting…", mutations looked like silent no-ops app-wide. v3 removes the
 * fetch handler entirely (installability only, no interception, no offline
 * shell — an offline visit now fails like any website). Every prior e2e run
 * dodged the bug because tests outran SW activation; this spec explicitly
 * WAITS for the SW to control the page before driving the action.
 */
import { expect, test, type Page } from './helpers/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('server actions round-trip under a CONTROLLING service worker (the v1/v2 abort regression)', async ({ page }) => {
  await signIn(page);

  // The SW registers on window-load (production build); v3's clients.claim()
  // takes control without a reload. Wait for actual CONTROL, not just an
  // active registration — control is what routed requests through the SW and
  // triggered the abort.
  await page.waitForFunction(
    async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg && reg.active && navigator.serviceWorker.controller);
    },
    undefined,
    { timeout: 20000 },
  );

  // Drive a real useActionState server action under the controlling SW:
  // set a budget target, see it render, then clear it (leaves the shared demo
  // DB target-free). Under the v1/v2 SW this sequence wedged at "Setting…".
  await page.goto('/budgets');
  await page.getByTestId('budget-category').selectOption('groceries');
  await page.getByTestId('budget-amount').fill('123');
  await page.getByTestId('budget-set').click();
  await expect(page.getByTestId('budget-clear-groceries')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('budget-clear-groceries').click();
  await expect(page.getByTestId('budget-clear-groceries')).toHaveCount(0, { timeout: 15000 });
});
