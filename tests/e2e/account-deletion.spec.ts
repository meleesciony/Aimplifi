/**
 * Delete-my-data confirmation gate (ROADMAP #10) + demo destroy fence (#244
 * critic P1-3), 380×800.
 *
 * The gate spec runs as a THROWAWAY signup user (since #244 the shared demo
 * hides the destructive controls entirely — one visitor must not be able to
 * wipe the demo for everyone, or sign every concurrent visitor out). It
 * verifies the SUMMARY + the typed-confirmation GATE only and never clicks the
 * final delete (the cascade itself is proven by the integration test in
 * tests/unit/account-deletion.test.ts). The demo spec asserts the honest
 * shared-account notes render INSTEAD of the controls.
 */
import { expect, test, type Page } from '@playwright/test';

async function signInDemo(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

async function signUpThrowaway(page: Page) {
  const email = `e2e-del-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

test('delete my data: shows the summary and gates the button behind the exact phrase', async ({ page }) => {
  // Throwaway user with one manual account, so the deletion summary is non-empty.
  await signUpThrowaway(page);
  await page.goto('/accounts');
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill('E2E Deletable Asset');
  await page.getByTestId('manual-type').selectOption('CASH');
  await page.getByTestId('manual-value').fill('100');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Deletable Asset' })).toBeVisible({
    timeout: 20000,
  });

  await page.goto('/settings');
  await expect(page.getByTestId('privacy-card')).toBeVisible();

  // The summary lists what would be removed (this user owns exactly one account).
  await expect(page.getByTestId('deletion-summary')).toContainText('linked accounts');

  const submit = page.getByTestId('delete-submit');
  const confirm = page.getByTestId('delete-confirm');

  await expect(submit).toBeDisabled(); // nothing typed
  await confirm.fill('delete'); // partial phrase
  await expect(submit).toBeDisabled();
  await confirm.fill('DELETE MY DATA'); // exact phrase, case-insensitive
  await expect(submit).toBeEnabled();
  await confirm.fill('not the phrase'); // wrong again → re-locks
  await expect(submit).toBeDisabled();

  // Intentionally NOT submitting — see the file header.
});

test('sessions: the "sign out of all devices" control renders on settings', async ({ page }) => {
  // Throwaway user — render + copy only. NOT clicked: the real epoch bump +
  // old-epoch rejection is proven by tests/unit/session-invalidation.test.ts.
  await signUpThrowaway(page);
  await page.goto('/settings');

  await expect(page.getByTestId('security-card')).toBeVisible();
  const revoke = page.getByTestId('revoke-sessions-submit');
  await expect(revoke).toBeVisible();
  await expect(revoke).toBeEnabled();
  await expect(page.getByTestId('security-card')).toContainText('every signed-in session');
});

test('demo destroy fence (#244): the shared demo sees honest notes, never the destructive controls', async ({
  page,
}) => {
  await signInDemo(page);
  await page.goto('/settings');

  // Sessions card: note instead of the revoke button.
  await expect(page.getByTestId('security-card')).toBeVisible();
  await expect(page.getByTestId('demo-sessions-note')).toContainText(/shared/i);
  await expect(page.getByTestId('revoke-sessions-submit')).toHaveCount(0);

  // Privacy card: note instead of the delete form.
  await expect(page.getByTestId('privacy-card')).toBeVisible();
  await expect(page.getByTestId('demo-delete-note')).toContainText(/shared/i);
  await expect(page.getByTestId('delete-form')).toHaveCount(0);
  await expect(page.getByTestId('delete-submit')).toHaveCount(0);
});
