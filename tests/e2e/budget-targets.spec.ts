/**
 * Budget targets (ROADMAP #7) — set a monthly target, overwrite it (atomic
 * upsert → one row), scan the target-bearing DOM for WCAG AA, then clear it.
 *
 * ONE sequential test: e2e runs fullyParallel on a single reseeded demo DB. This
 * test sets/overwrites ONE target on Dining Out and clears it at the end, so the
 * shared DB is left target-free. Budget targets are display-only (they feed
 * nothing but the /budgets view — not cash-needed, FI, or net worth), so this
 * perturbs no golden value, and no other spec asserts a budget target.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './helpers/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('budget targets: set, scan a11y, overwrite atomically, then clear', async ({ page }) => {
  await signIn(page);
  await page.goto('/budgets');
  await expect(page.getByTestId('budget-list')).toBeVisible();
  // Seed has no budgets (#37) — first-run hint is visible before we set one (#186).
  await expect(page.getByTestId('budget-no-targets-hint')).toBeVisible();

  // Set a $500/mo target on Dining Out.
  await page.getByTestId('budget-category').selectOption('dining');
  await page.getByTestId('budget-amount').fill('500');
  await page.getByTestId('budget-set').click();

  const row = page.getByTestId('budget-row-dining');
  await expect(row).toBeVisible();
  await expect(page.getByTestId('budget-no-targets-hint')).toHaveCount(0);
  await expect(row).toContainText('/ $500.00'); // actual / target
  await expect(row).toContainText(/left this month|over target/); // remaining status
  await expect(page.getByTestId('budget-clear-dining')).toBeVisible();

  // WCAG AA on the target-bearing DOM (Clear button, progress bar, status text) —
  // the seed has no budgets, so the phase5 scan never sees these conditional nodes.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // Overwrite the SAME category — the upsert must yield ONE row at the new amount.
  await page.getByTestId('budget-category').selectOption('dining');
  await page.getByTestId('budget-amount').fill('700');
  await page.getByTestId('budget-set').click();
  await expect(row).toContainText('/ $700.00');
  await expect(row).not.toContainText('/ $500.00');
  await expect(page.getByTestId('budget-row-dining')).toHaveCount(1); // not duplicated

  // Clear it — this is also the cleanup, leaving the shared demo DB target-free.
  //
  // The clear awaits its server action UNDER A DEADLINE and reloads in `finally` — the
  // component's own comment says the clear "usually COMMITTED" when the deadline fires. On a
  // loaded CI runner that reload can beat the commit, and one reload is ONE read: the old 15s
  // poll then watched a static post-reload DOM forever ("33 × resolved to 1" — the long-lived
  // "documented CI flake" at this exact line, same family as category-rename:110). So: wait for
  // the action's own response first, then poll with RELOADS, so a slow commit is re-read rather
  // than immortalised.
  const actionSettled = page
    .waitForResponse((r) => r.request().method() === 'POST', { timeout: 12000 })
    .catch(() => null);
  await page.getByTestId('budget-clear-dining').click();
  await actionSettled;
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('budget-clear-dining')).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
});
