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
import AxeBuilder from '@axe-core/playwright';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('settings surfaces the AI-trust accuracy panel (Competitive-Gap Gap 4 §2)', async ({ page }) => {
  // Read-only: this asserts the panel renders and reconciles with the seeded
  // accuracy data. It mutates nothing, so it is golden-safe alongside the mutating
  // dials test in this file under the fullyParallel suite.
  await signIn(page);
  await page.goto('/settings');

  const card = page.getByTestId('ai-trust-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('AI trust');
  await expect(card).toContainText('Categorization accuracy');
  // the seeded demo has labeled predictions (n > 0), so a real percentage renders
  // (same guarantee the triage accuracy-card test relies on).
  await expect(card).toContainText('%');
  // the no-fabrication promise is stated plainly (Gap 4 — make the trust moat visible)
  await expect(card).toContainText('never invents');

  // the new panel itself is WCAG-AA clean (scoped so unrelated page content can't flake it)
  const results = await new AxeBuilder({ page })
    .include('[data-testid="ai-trust-card"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

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

  // ── retirement plan (DECISIONS #123) ──
  // The demo user is un-customized, so all four planning fields are blank (= use the
  // documented default — the projection on /investments is unchanged).
  await expect(page.getByTestId('dials-current-age')).toHaveValue('');
  await expect(page.getByTestId('dials-retirement-age')).toHaveValue('');
  await expect(page.getByTestId('dials-end-age')).toHaveValue('');
  await expect(page.getByTestId('dials-inflation')).toHaveValue('');

  // ordering validation: a retirement age before the (default 40) current age → inline
  // error, nothing saved.
  await page.getByTestId('dials-retirement-age').fill('30');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-error-retirementAge')).toBeVisible();
  await expect(page.getByTestId('dials-saved')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('dials-retirement-age')).toHaveValue(''); // unchanged in the DB

  // round-trip the plan through the DB at the EXPLICIT default values — proves persistence
  // while keeping the demo projection identical (golden-safe under the parallel suite).
  await page.getByTestId('dials-current-age').fill('40');
  await page.getByTestId('dials-retirement-age').fill('65');
  await page.getByTestId('dials-end-age').fill('95');
  await page.getByTestId('dials-inflation').fill('2.5');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('dials-current-age')).toHaveValue('40');
  await expect(page.getByTestId('dials-retirement-age')).toHaveValue('65');
  await expect(page.getByTestId('dials-end-age')).toHaveValue('95');
  await expect(page.getByTestId('dials-inflation')).toHaveValue('2.50'); // 250 bps display

  // ── clear them back to unset (seed state) so reruns + sibling specs stay deterministic ──
  await page.getByTestId('dials-current-age').fill('');
  await page.getByTestId('dials-retirement-age').fill('');
  await page.getByTestId('dials-end-age').fill('');
  await page.getByTestId('dials-inflation').fill('');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('dials-current-age')).toHaveValue('');
  await expect(page.getByTestId('dials-retirement-age')).toHaveValue('');
  await expect(page.getByTestId('dials-end-age')).toHaveValue('');
  await expect(page.getByTestId('dials-inflation')).toHaveValue('');
});
