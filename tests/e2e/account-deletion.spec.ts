/**
 * Delete-my-data confirmation gate (ROADMAP #10), 380×800.
 *
 * This test verifies the SUMMARY + the typed-confirmation GATE only. It never
 * clicks the final delete: the action would irreversibly wipe the single shared
 * demo user and break every other parallel spec (and the cascade itself is proven
 * by the integration test in tests/unit/account-deletion.test.ts). The gate is
 * pure client state, so exercising it mutates nothing.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('delete my data: shows the summary and gates the button behind the exact phrase', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  await expect(page.getByTestId('privacy-card')).toBeVisible();

  // The summary lists what would be removed (the demo user has accounts + transactions).
  await expect(page.getByTestId('deletion-summary')).toContainText('transactions');
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
