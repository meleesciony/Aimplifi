/**
 * Backfill button wiring (#167 critic P2: this surface had zero automated
 * coverage). THROWAWAY USER: on the shared demo, a mid-suite backfill could
 * refile rows the parallel triage specs are reviewing — and a fresh user makes
 * the expected result deterministic ("Nothing in review to re-check.", the
 * inline no-reload branch). The refiled>0 flash+reload branch is covered by
 * scripts/audit-probes/backfill-mutation.ts + tests/unit/flash.test.ts.
 *
 * REGRESSION #260: the user must own an ACCOUNT before /triage renders its
 * toolbar at all. #259 (agent-review A3) gave /triage a zero-account first-run
 * empty, which correctly replaces the whole page — Backfill included — for a
 * brand-new signup. This spec's premise had been "fresh signup = empty review
 * pile", which silently became "fresh signup = no Backfill button", so it timed
 * out looking for a control the product had deliberately hidden. One manual
 * asset satisfies the gate and still leaves the review pile empty (a typed
 * balance creates no transactions), so the assertion below is unchanged.
 */
import { expect, test } from './helpers/test';

test('re-run categorizer reports honestly on an empty review pile', async ({ page }) => {
  const email = `e2e-backfill-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // Past the zero-account gate: one manual asset, no transactions.
  await page.goto('/accounts');
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill('E2E Backfill Asset');
  await page.getByTestId('manual-type').selectOption('REAL_ESTATE');
  await page.getByTestId('manual-value').fill('1000');
  await page.getByTestId('manual-submit').click();
  await expect(
    page.getByTestId('manual-account-row').filter({ hasText: 'E2E Backfill Asset' }),
  ).toBeVisible({ timeout: 20000 });

  await page.goto('/triage');
  // The first-run empty must be gone now — if it isn't, the gate moved again and
  // the timeout below would blame the button instead of the page.
  await expect(page.getByTestId('triage-first-run-empty')).toHaveCount(0);
  await expect(async () => {
    await page.getByTestId('backfill-run').click({ timeout: 2000 });
    await expect(page.getByTestId('backfill-result')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await expect(page.getByTestId('backfill-result')).toHaveText('Nothing in review to re-check.', {
    timeout: 20000,
  });
  await expect(page.getByTestId('backfill-error')).toHaveCount(0);
});
