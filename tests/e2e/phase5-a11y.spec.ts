/**
 * Phase 5 accessibility pass: axe (WCAG 2.0/2.1 AA) on every core flow at
 * 380×800, plus keyboard navigation of the primary action path.
 * Violations fail the build — exceptions must be listed (currently none).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  if (results.violations.length > 0) {
    console.log(`[axe:${label}]`, JSON.stringify(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      })),
      null,
      2,
    ));
  }
  expect(results.violations, `axe violations on ${label}`).toEqual([]);
}

test('sign-in page passes WCAG AA', async ({ page }) => {
  await page.goto('/sign-in');
  await expectNoViolations(page, 'sign-in');
});

test('dashboard passes WCAG AA', async ({ page }) => {
  await signIn(page);
  await expectNoViolations(page, 'dashboard');
});

test('cards page passes WCAG AA (both scenarios)', async ({ page }) => {
  await signIn(page);
  await page.goto('/cards');
  await expectNoViolations(page, 'cards:pay-in-full');
  await page.getByTestId('toggle-minimum').click();
  await expectNoViolations(page, 'cards:minimum');
});

test('triage inbox passes WCAG AA', async ({ page }) => {
  await signIn(page);
  await page.goto('/triage');
  await expectNoViolations(page, 'triage');
});

test('coach page passes WCAG AA', async ({ page }) => {
  await signIn(page);
  await page.goto('/coach');
  await expectNoViolations(page, 'coach');
});

test('calendar, goals, budgets, settings pass WCAG AA', async ({ page }) => {
  await signIn(page);
  for (const path of ['/calendar', '/goals', '/budgets', '/settings']) {
    await page.goto(path);
    await expectNoViolations(page, path);
  }
});

test('keyboard-only: sign in and reach the cash-needed answer', async ({ page }) => {
  await page.goto('/sign-in');
  // The email/password form is now the primary action, so it's first in tab order.
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('auth-email')).toBeFocused();
  // The demo button is keyboard-focusable and Enter-activatable.
  await page.getByTestId('demo-sign-in').focus();
  await expect(page.getByTestId('demo-sign-in')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/dashboard');
  await expect(page.getByTestId('cash-needed-amount')).toBeVisible();
  // scenario toggle reachable and operable by keyboard on /cards
  await page.goto('/cards');
  await page.getByTestId('toggle-minimum').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('scenario-required')).toHaveText('$2,135.00');
});
