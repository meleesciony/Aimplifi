/**
 * Money Dials settings / onboarding flow (380×800).
 *
 * ONE sequential test on purpose: e2e runs fullyParallel against a single
 * reseeded demo DB, and these dials are mutable per-user state. Keeping the
 * whole flow in one test means no other test races on the values, and this test
 * restores moneyDials to its seed value at the end so repeat runs stay
 * deterministic. The numeric dials (wage/swr/return) and the payment account are
 * only ever written back at their seed values here, so the golden cash-needed /
 * FI numbers other specs assert are never perturbed.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('money dials: dormant nudge in demo, pre-populated form, validates, round-trips', async ({ page }) => {
  await signIn(page);

  // The onboarding nudge is gated on an unset payment account — the demo user
  // always has one, so it must NOT appear (and never displaces the answer).
  await expect(page.getByTestId('onboarding-nudge')).toHaveCount(0);

  // Reach settings directly (same convention as the a11y specs — the top-nav
  // icon row is exercised elsewhere; this test is about the dials).
  await page.goto('/settings');

  // ── pre-populated from the stored values ──
  await expect(page.getByTestId('money-dials-card')).toBeVisible();
  await expect(page.getByTestId('dials-swr')).toHaveValue('4');
  await expect(page.getByTestId('dials-return')).toHaveValue('7');
  await expect(page.getByTestId('dials-wage')).toHaveValue('38');
  await expect(page.getByTestId('dials-money-dials')).toHaveValue('Travel, Dining Out');

  // payment account: a value is selected; checking/savings are offered, credit
  // cards are not (only fundable accounts are eligible).
  const account = page.getByTestId('dials-payment-account');
  await expect(account).not.toHaveValue('');
  await expect(account).toContainText('Everyday Checking');
  await expect(account).toContainText('High-Yield Savings');
  await expect(account).not.toContainText('Sapphire Card');

  // ── validation: 0% SWR would divide-by-zero the FI number → inline error, no save ──
  await page.getByTestId('dials-swr').fill('0');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-error-swr')).toBeVisible();
  await expect(page.getByTestId('dials-saved')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('dials-swr')).toHaveValue('4'); // unchanged in the DB

  // ── round-trip a real change through the DB (moneyDials carries no golden value) ──
  await page.getByTestId('dials-money-dials').fill('Travel, Dining Out, Climbing');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible();
  await page.reload(); // re-mounts from the DB → proves persistence, not just client state
  await expect(page.getByTestId('dials-money-dials')).toHaveValue('Travel, Dining Out, Climbing');

  // ── restore the seed value so reruns stay deterministic ──
  await page.getByTestId('dials-money-dials').fill('Travel, Dining Out');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible();
});
