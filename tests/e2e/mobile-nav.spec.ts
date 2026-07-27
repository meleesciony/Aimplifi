/**
 * Mobile More sheet (DECISIONS #187 / Gap 3 §2): labelled secondary destinations
 * replace the old 8 unlabeled top icons. Primary bottom tabs stay unchanged.
 *
 * Prefer mid-viewport / header clicks (nav-more) over fixed-bottom clicks for
 * new assertions — see docs/lessons/mobile-380-viewport-scaling-flake.md.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './helpers/test';
import { clickMoreNav, openMoreNav } from './helpers/more-nav';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('More sheet: opens labelled destinations, navigates, Escape closes', async ({ page }) => {
  await signIn(page);

  // Header is clean: More is visible; secondary links are NOT in the top bar.
  await expect(page.getByTestId('nav-more')).toBeVisible();
  await expect(page.getByTestId('nav-more')).toHaveText(/More/);
  await expect(page.getByTestId('nav-spending-plan')).toHaveCount(0);
  await expect(page.getByTestId('bottom-nav')).toBeVisible();

  await openMoreNav(page);
  const sheet = page.getByTestId('nav-more-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'More' })).toBeVisible();

  // Every secondary destination is labelled (icon + text), not icon-only.
  for (const id of [
    'nav-spending-plan',
    'nav-reports',
    'nav-accounts',
    'nav-investments',
    'nav-transactions',
    'nav-goals',
    'nav-budgets',
    'nav-settings',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // Discover section surfaces dashboard-only routes.
  await expect(page.getByTestId('nav-ask')).toBeVisible();
  await expect(page.getByTestId('nav-trends')).toBeVisible();
  // A6 (2026-07-21 review): the AI Trust Center was reachable only from a card
  // inside /settings — it now sits with the other dashboard-adjacent surfaces.
  await expect(page.getByTestId('nav-trust')).toBeVisible();

  // WCAG AA on the open sheet.
  const axe = await new AxeBuilder({ page })
    .include('[data-testid="nav-more-sheet"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  // Escape closes and returns focus to the trigger.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('nav-more-sheet')).toHaveCount(0);
  await expect(page.getByTestId('nav-more')).toBeFocused();

  // Navigate via More → Plan.
  await clickMoreNav(page, 'nav-spending-plan');
  await page.waitForURL('**/spending-plan');
  await expect(page.getByTestId('spending-plan-hero')).toBeVisible();
  // Sheet closes on navigate.
  await expect(page.getByTestId('nav-more-sheet')).toHaveCount(0);
  // More stays highlighted while on a secondary route.
  await expect(page.getByTestId('nav-more')).toBeVisible();
});
