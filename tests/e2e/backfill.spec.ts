/**
 * Backfill button wiring (#167 critic P2: this surface had zero automated
 * coverage). THROWAWAY USER: on the shared demo, a mid-suite backfill could
 * refile rows the parallel triage specs are reviewing — and a fresh user makes
 * the expected result deterministic ("Nothing in review to re-check.", the
 * inline no-reload branch). The refiled>0 flash+reload branch is covered by
 * scripts/audit-probes/backfill-mutation.ts + tests/unit/flash.test.ts.
 */
import { expect, test } from '@playwright/test';

test('re-run categorizer reports honestly on an empty review pile', async ({ page }) => {
  const email = `e2e-backfill-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('/triage');
  await page.getByTestId('backfill-run').click();
  await expect(page.getByTestId('backfill-result')).toHaveText('Nothing in review to re-check.', {
    timeout: 20000,
  });
  await expect(page.getByTestId('backfill-error')).toHaveCount(0);
});
