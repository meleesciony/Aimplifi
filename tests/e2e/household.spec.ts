/**
 * Household membership core — /settings Household section (TASKS 4.2 slice 1).
 *
 * RENDER-ONLY on purpose (the #182 render-only Sessions precedent): the demo
 * user must NEVER join a household (HOUSEHOLD_ARCHITECTURE T6 — golden/demo
 * safety), so this spec asserts the empty-state card renders with the create
 * form and the honesty disclosure, and never clicks a mutation. The behavior
 * load is carried by tests/unit/household-actions.test.ts (real actions
 * against throwaway users).
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('settings renders the Household card in its no-household state (T6: demo user has no membership)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/settings');

  const card = page.getByTestId('household-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Household');

  // Honesty disclosure: membership alone shares nothing.
  await expect(page.getByTestId('household-disclosure')).toContainText('shares');
  await expect(page.getByTestId('household-disclosure')).toContainText('nothing');

  // Demo user has no membership and no incoming invites — the create form is
  // the whole body: no member rows, no invite entry, no leave control.
  await expect(page.getByTestId('household-create-form')).toBeVisible();
  await expect(page.getByTestId('household-create-name')).toBeVisible();
  await expect(page.getByTestId('household-member-row')).toHaveCount(0);
  await expect(page.getByTestId('household-incoming-invite')).toHaveCount(0);
  await expect(page.getByTestId('household-leave')).toHaveCount(0);

  // The new card itself is WCAG-AA clean (scoped, per the ai-trust precedent).
  const results = await new AxeBuilder({ page })
    .include('[data-testid="household-card"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
