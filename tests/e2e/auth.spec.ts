/**
 * Real email/password auth (DECISIONS #43): a brand-new user can sign up, lands
 * on first-run onboarding (no accounts yet) with NO "demo dataset" banner, signs
 * out, and signs back in. The one-click demo remains covered by the other specs.
 */
import { expect, test } from '@playwright/test';

test('email/password sign-up → empty onboarding → sign out → sign back in', async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  await page.goto('/sign-in');

  // Switch the form to "Create account", then sign up.
  await page.getByTestId('auth-toggle').click();
  await expect(page.getByTestId('auth-form')).toHaveAttribute('data-mode', 'signup');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();

  // New user → first-run onboarding, and NO demo banner (this is a real account).
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);

  // Other engine-backed pages must show onboarding too, not crash (DECISIONS #43).
  await page.goto('/cards');
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();
  await page.goto('/coach');
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();

  // Sign out.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/sign-in', { timeout: 20000 });

  // Sign back in (form defaults to sign-in mode).
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();
});

test('wrong password is rejected with a friendly error', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('auth-email').fill('nobody-here@aimplifi.test');
  await page.getByTestId('auth-password').fill('definitely-wrong');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-error')).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/sign-in/);
});
