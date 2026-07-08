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
  // Onboarding is the ENTIRE page for a zero-account user, so it must still carry a
  // single real <h1> for screen readers (production-readiness backlog, 2026-06-24) —
  // not just the CardTitle's default <h2>.
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Welcome to Aimplifi 👋');

  // Every cash-engine-backed page shows onboarding (not a crash) for a zero-account user (#44).
  for (const path of ['/cards', '/coach', '/goals', '/calendar']) {
    await page.goto(path);
    await expect(page.getByTestId('empty-dashboard'), `${path} should onboard, not crash`).toBeVisible({
      timeout: 20000,
    });
  }
  // /accounts shows its own first-run empty state (not a meaningless $0.00 net worth).
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('accounts-net-worth')).toHaveCount(0);

  // The remaining nav pages render their own empty states — assert no error boundary.
  for (const path of ['/transactions', '/budgets', '/triage', '/settings']) {
    await page.goto(path);
    await expect(page.getByTestId('app-error'), `${path} should not crash`).toHaveCount(0);
  }

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

test('first manual account → dashboard explains its sparse cards (no bare $0.00)', async ({ page }) => {
  const email = `e2e-sparse-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();

  // Add one manual asset: an account now exists (the dashboard renders) but there
  // is still no income / spending / recurring data.
  await page.goto('/accounts');
  await page.getByTestId('add-asset-btn').click();
  await page.getByTestId('manual-name').fill('Primary home');
  await page.getByTestId('manual-value').fill('100000');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row')).toBeVisible({ timeout: 20000 });

  // The dashboard now renders the real cards — the sparse ones must explain
  // themselves rather than show a bare $0.00.
  await page.goto('/dashboard');
  await expect(page.getByTestId('empty-dashboard')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-safe-to-spend-empty')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('dashboard-recurring-empty')).toBeVisible();

  // Coach page with zero transactions: opportunities and life-energy must explain
  // their emptiness rather than render a silent blank list (production-readiness
  // backlog, 2026-06-24).
  await page.goto('/coach');
  await expect(page.getByTestId('opportunities-empty')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('opportunities-list')).toHaveCount(0);
  await expect(page.getByTestId('life-energy-empty')).toBeVisible();
  await expect(page.getByTestId('life-energy-list')).toHaveCount(0);
});

test('wrong password is rejected with a friendly error', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('auth-email').fill('nobody-here@aimplifi.test');
  await page.getByTestId('auth-password').fill('definitely-wrong');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-error')).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/sign-in/);
});
