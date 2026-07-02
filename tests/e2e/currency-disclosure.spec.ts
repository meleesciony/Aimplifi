/**
 * Currency-guard disclosure banner (#135 residual): a withheld non-USD account must
 * not vanish SILENTLY from the dashboard figures or /accounts — the banner says what
 * was left out and why, and renders NOTHING for an all-USD user.
 *
 * Positive path uses a throwaway signup user + the guarded
 * scripts/e2e-add-foreign-account.ts helper: the seeded demo user is all-USD by
 * design and SHARED across the fully-parallel specs, so mutating it would leak this
 * banner into every other spec's dashboard mid-run. Negative path locks the
 * zero-render contract on the demo user (all-USD pages stay byte-identical).
 */
import { execSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

test('all-USD demo user sees no disclosure banner anywhere (zero-render lock)', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  // Prove the page fully rendered before asserting absence — anchor on PAGE content
  // (net-worth-card sits below the route-group Suspense boundary). The layout's
  // demo-banner flushes while <main> still shows the loading skeleton, so anchoring on
  // it made the absence assertion vacuous (checker P1: it passed against the skeleton).
  await expect(page.getByTestId('net-worth-card')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('currency-exclusion-banner')).toHaveCount(0);

  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('currency-exclusion-banner')).toHaveCount(0);
});

test('withheld foreign accounts surface the disclosure on the dashboard and /accounts', async ({ page }) => {
  const email = `e2e-fx-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  // Ad-hoc real signup (tests/e2e/auth.spec.ts pattern) — lands on empty onboarding.
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();

  // Insert 1 USD + EUR + GBP accounts via the guarded helper (refuses any DB that
  // is not the off-tree e2e file, and any email that is not an @aimplifi.test throwaway).
  execSync(`npx tsx scripts/e2e-add-foreign-account.ts ${email}`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  // Dashboard: real cards now render, and the disclosure states count + currencies.
  // Bare locator throughout (NO .first()): strict mode then also locks single-render —
  // a double-mounted banner (doubled role="status" announcement) fails here (checker P2).
  await page.goto('/dashboard');
  const banner = page.getByTestId('currency-exclusion-banner');
  await expect(banner).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toHaveCount(0);
  await expect(banner).toContainText('2 accounts not included — not in U.S. dollars');
  await expect(banner).toContainText('EUR, GBP');
  await expect(banner).toContainText('Nothing is deleted');

  // /accounts: same disclosure; the withheld accounts themselves stay OFF the page
  // (the #135 guard) — only the banner speaks for them. The USD account is listed.
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('currency-exclusion-banner')).toBeVisible();
  await expect(page.getByText('E2E US Checking')).toBeVisible();
  await expect(page.getByText('E2E Euro Savings')).toHaveCount(0);
  await expect(page.getByText('E2E UK Card')).toHaveCount(0);

  // The demo user never renders the banner, so the phase-5 axe pass can't cover it —
  // scan here with the banner present (WCAG A/AA, the #136 write-in-form precedent).
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
});
