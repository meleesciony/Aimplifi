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
 *
 * The budget round-trip runs on a THROWAWAY user (the budget-targets.spec.ts
 * pattern, TASKS G.1): budget writes are fenced off the shared demo row (the
 * fence locks live in tests/unit/shared-demo-fences.test.ts), so the action
 * under test is driven against a fresh user's own row — no other spec reads
 * it, and the "leave the DB clean" clear is still asserted for the round-trip.
 * The throwaway user needs one account so /budgets renders the target list
 * instead of first-run onboarding.
 */
import { expect, test, type Page } from './helpers/test';
import Database from 'better-sqlite3';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpAndSeed(page: Page) {
  const email = `e2e-pwa-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`signUpAndSeed: user ${email} not found`);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Checking', 'CHECKING', 250000, 'USD')`,
    ).run(`e2e-pwa-acct-${suffix}`, user.id, `pw-${suffix}`);
  } finally {
    db.close();
  }
  return email;
}

test('server actions round-trip under a CONTROLLING service worker (the v1/v2 abort regression)', async ({ page }) => {
  await signUpAndSeed(page);

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
  // set a budget target, see it render, then clear it (on the throwaway
  // user's own row — nothing else reads it). Under the v1/v2 SW this sequence
  // wedged at "Setting…".
  await page.goto('/budgets');
  await page.getByTestId('budget-category').selectOption('groceries');
  await page.getByTestId('budget-amount').fill('123');
  await page.getByTestId('budget-set').click();
  await expect(page.getByTestId('budget-clear-groceries')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('budget-clear-groceries').click();
  await expect(page.getByTestId('budget-clear-groceries')).toHaveCount(0, { timeout: 15000 });
});
