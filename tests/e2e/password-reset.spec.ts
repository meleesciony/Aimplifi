/**
 * Forgot-password flow (#257) — the browser-reachable half. The full
 * token-in-email path cannot run in e2e (no mailbox in the test env), so it is
 * integration-locked in tests/unit/password-reset-server.test.ts against the
 * real core; here we lock the surfaces: the sign-in link, the public pages
 * (middleware must NOT bounce them to /sign-in), the enumeration-neutral
 * confirmation, and the bogus-token refusal.
 */
import { expect, test } from '@playwright/test';

test('sign-in offers a forgot-password link that reaches the public request page', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByTestId('forgot-password-link')).toBeVisible();
  await page.getByTestId('forgot-password-link').click();
  await page.waitForURL('**/forgot-password');
  await expect(page.getByTestId('reset-request-form')).toBeVisible();
});

test('requesting a reset for an unknown email shows the SAME neutral confirmation', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByTestId('reset-email').fill(`e2e-nobody-${Date.now()}@aimplifi.test`);
  await page.getByTestId('reset-request-submit').click();
  await expect(page.getByTestId('reset-request-sent')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('reset-request-sent')).toContainText('If an account exists');
});

test('reset page without a token offers the request link; a bogus token refuses neutrally', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByTestId('reset-missing-token-link')).toBeVisible();

  await page.goto('/reset-password?token=bogus-token-e2e');
  await page.getByTestId('reset-password-input').fill('a-fresh-password-123');
  await page.getByTestId('reset-confirm-submit').click();
  await expect(page.getByTestId('reset-confirm-error')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('reset-confirm-error')).toContainText('invalid, already used, or expired');
});
