/**
 * Activity's secondary filters (type, account, category, tag, class, period, dates) fold behind
 * one "Filters" control below `sm` (TASKS U.1a). A spec that drives one of them from an
 * UNFILTERED register at the 380px project has to open the bar first; a spec that arrives
 * already filtered does not — the bar opens itself whenever one of those axes is narrowing
 * the set.
 *
 * Open by STATE, never by toggle (the `openAccountCleanup` rule): a click that lands before
 * hydration is a no-op and one that lands after a deep link's default-open would CLOSE the
 * bar, and either failure surfaces on whatever assertion runs next. Reading `aria-expanded`
 * and retrying makes both orders safe.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function openActivityFilters(page: Page) {
  const toggle = page.getByTestId('txn-filters-toggle');
  await expect(page.getByTestId('txn-filters')).toBeVisible({ timeout: 20_000 });
  // From `sm` up the toggle is not rendered visibly and the bar is always open.
  if (!(await toggle.isVisible())) return;
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}
