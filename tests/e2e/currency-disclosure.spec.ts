/**
 * Currency-guard disclosure banner (#135 residual): a withheld non-USD account must
 * not vanish SILENTLY from the dashboard figures, /accounts, or /investments — the
 * banner says what was left out and why, and renders NOTHING for an all-USD user.
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

  // /investments (STATUS #23 extension): anchor on the holdings summary — page content
  // below the boundary; the seeded demo user always has holdings (investments.spec.ts:73).
  await page.goto('/investments');
  await expect(page.getByTestId('investments-summary')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('currency-exclusion-banner')).toHaveCount(0);

  // The categorization / analytics surfaces (STATUS #23 extension): the banner must be
  // absent for the all-USD demo user on each, anchored on page content that renders
  // BELOW the route-group Suspense boundary (the #141 P1 anchor rule — never a layout
  // element that flushes while <main> still shows the loading skeleton).
  for (const { path, anchor } of [
    { path: '/transactions', anchor: 'txn-list' },
    { path: '/triage', anchor: 'triage-inbox' },
    { path: '/recurring', anchor: 'recurring-hero' },
    { path: '/reports', anchor: 'income-expense-chart' },
    { path: '/coach', anchor: 'fi-number' },
  ]) {
    await page.goto(path);
    await expect(page.getByTestId(anchor)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('currency-exclusion-banner')).toHaveCount(0);
    // #135 residual 25: the inline projection/total note is also gated on withheld > 0.
    if (path === '/coach') await expect(page.getByTestId('fi-currency-note')).toHaveCount(0);
    if (path === '/reports') await expect(page.getByTestId('reports-currency-note')).toHaveCount(0);
  }
});

test('withheld foreign accounts surface the disclosure on the dashboard, /accounts, and /investments', async ({ page }) => {
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
  await expect(banner).toContainText('3 accounts not included — not in U.S. dollars');
  await expect(banner).toContainText('EUR, GBP'); // EUR deduped across savings + brokerage
  await expect(banner).toContainText('Nothing is deleted');

  // /accounts: same disclosure; the withheld accounts themselves stay OFF the page
  // (the #135 guard) — only the banner speaks for them. The USD account is listed.
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('currency-exclusion-banner')).toBeVisible();
  await expect(page.getByText('E2E US Checking')).toBeVisible();
  await expect(page.getByText('E2E Euro Savings')).toHaveCount(0);
  await expect(page.getByText('E2E UK Card')).toHaveCount(0);
  await expect(page.getByText('E2E Euro Brokerage')).toHaveCount(0);

  // The demo user never renders the banner, so the phase-5 axe pass can't cover it —
  // scan here with the banner present (WCAG A/AA, the #136 write-in-form precedent).
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  // /investments (STATUS #23 extension): the USD checking account passes the page gate,
  // has no holdings → the withheld-aware empty state renders under the same banner.
  // The Euro BROKERAGE assertion is the real guard witness here: it is INVESTMENT-typed,
  // so ONLY the currency filter (getInvestments' isSupportedCurrency, unit-locked in
  // currency-guard.test.ts P1-A) keeps it off this page — the SAVINGS/CREDIT rows could
  // never appear via getInvestments regardless of the guard (#145 checker P2).
  await page.goto('/investments');
  const investmentsEmpty = page.getByTestId('investments-empty');
  await expect(investmentsEmpty).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('currency-exclusion-banner')).toBeVisible();
  await expect(page.getByTestId('currency-exclusion-banner')).toContainText(
    '3 accounts not included — not in U.S. dollars',
  );
  await expect(investmentsEmpty).toContainText('No U.S.-dollar investment holdings yet');
  await expect(page.getByText('E2E Euro Brokerage')).toHaveCount(0);
  await expect(page.getByText('E2E Euro Savings')).toHaveCount(0);
  await expect(page.getByText('E2E UK Card')).toHaveCount(0);

  // Axe again on THIS surface: the withheld-aware empty-state copy variant renders only
  // here (the /accounts scan above never sees it — that user has a listed USD account).
  const axeInvestments = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axeInvestments.violations).toEqual([]);

  // The categorization / analytics surfaces (STATUS #23 extension): the same disclosure
  // must surface on each, AND the role="status" Alert must be WCAG A/AA-clean WITH THE
  // BANNER PRESENT. phase5-a11y's /triage + /coach axe pins run on the all-USD demo user,
  // where the banner self-nulls (absent from the DOM), so they never exercise it — scan
  // each surface here instead (the #136 write-in-form axe precedent). Bare locator (NO
  // .first()) also locks single-render per surface. The fx user has a USD checking
  // account, so each page passes its supported-account gate.
  for (const path of ['/transactions', '/triage', '/recurring', '/reports', '/coach']) {
    await page.goto(path);
    const b = page.getByTestId('currency-exclusion-banner');
    await expect(b).toBeVisible({ timeout: 20000 });
    await expect(b).toContainText('EUR, GBP');
    // #135 residual 25: the currency-exclusion assumption is also stated inline AT the
    // flagship FI projection (/coach) and the spending total (/reports).
    if (path === '/coach')
      await expect(page.getByTestId('fi-currency-note')).toContainText('not in U.S. dollars');
    if (path === '/reports')
      await expect(page.getByTestId('reports-currency-note')).toContainText('not in U.S. dollars');
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
  }
});

test('zero-withheld user keeps the ORIGINAL investments empty-state copy (byte-identity lock)', async ({ page }) => {
  // #145 checker P2: the zero-withheld else-branch was the one copy path no test
  // rendered — the demo user always has holdings and the fx fixture always has
  // withheld accounts. A USD-only throwaway (passes the supported-account page
  // gate, zero holdings, zero withheld) mounts exactly that branch.
  const email = `e2e-usd-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  execSync(`npx tsx scripts/e2e-add-foreign-account.ts ${email} --usd-only`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  await page.goto('/investments');
  const investmentsEmpty = page.getByTestId('investments-empty');
  await expect(investmentsEmpty).toBeVisible({ timeout: 20000 });
  // The original copy, verbatim — a withheld-flavored regression here means the
  // zero-withheld branch changed (the increment promised it byte-identical).
  await expect(investmentsEmpty).toContainText(
    'No investment holdings yet. Add holdings to an investment account to see market value, gain, and allocation here.',
  );
  await expect(page.getByTestId('currency-exclusion-banner')).toHaveCount(0);
});
