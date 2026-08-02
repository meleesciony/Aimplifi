/**
 * Owner request, 2026-08-02: *"again, make all charts and summaries, expandable.
 * for instance, if i want to know why and where cash come from that caused
 * greater savings for a specific month, i should be able to click on the graph
 * itself"*.
 *
 * The unit lock proves the ROWS are the ones that month was summed from. This
 * proves the GESTURE, which is the whole of the request: a bar on /coach's
 * savings-rate chart is a real control that opens those rows in place. Before
 * this slice the bars were `<div>`s carrying a `title` — a hover tooltip, which
 * on the phone the owner uses does not exist at all.
 *
 * Runs as the demo (a read-only drill-down that creates nothing), because the
 * demo is the only fixture with twelve months of history to draw bars from.
 */
import { expect, test } from './helpers/test';

test('a savings-rate bar opens the income and spending it was computed from', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach');

  const card = page.getByTestId('savings-rate-card');
  await expect(card).toBeVisible();

  // The fixture's hard case: there are bars to press. A chart with no months
  // would let every assertion below pass by never running.
  const bars = card.locator('[data-testid^="savings-rate-bar-"]');
  await expect(bars.first()).toBeVisible();
  const count = await bars.count();
  expect(count).toBeGreaterThan(1);

  // Nothing is expanded until the reader asks.
  await expect(page.getByTestId('savings-rate-month-detail')).toHaveCount(0);

  // Press the LAST bar — the most recent full month, the one a reader comparing
  // "why was this month better" actually reaches for.
  const last = bars.nth(count - 1);
  await expect(last).toHaveAttribute('aria-expanded', 'false');
  await last.click();

  const detail = page.getByTestId('savings-rate-month-detail');
  await expect(detail).toBeVisible();
  await expect(last).toHaveAttribute('aria-expanded', 'true');

  // Both halves of the rate, open, with rows — and each panel states the sum it
  // reconciles to. The panel ids are `<month>-income` / `<month>-expense`.
  const incomeRows = detail.locator('[data-testid^="savings-rate-income-rows-"]');
  const expenseRows = detail.locator('[data-testid^="savings-rate-expense-rows-"]');
  await expect(incomeRows.or(detail.locator('[data-testid^="savings-rate-income-empty-"]'))).toBeVisible();
  await expect(expenseRows).toBeVisible();
  await expect(expenseRows.locator('li').first()).toBeVisible();

  // The reconciliation marker is the point of the panel: these rows ADD UP to
  // the figure the bar was drawn from.
  await expect(detail.locator('[data-testid^="savings-rate-expense-sum-"]')).toBeVisible();

  // It is a toggle, not a one-way door.
  await last.click();
  await expect(page.getByTestId('savings-rate-month-detail')).toHaveCount(0);
});

test('savings-rate bars are reachable by keyboard and name their month and rate', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach');

  const bars = page.getByTestId('savings-rate-card').locator('[data-testid^="savings-rate-bar-"]');
  const first = bars.first();
  // The drawn height is clamped to ±100% and colour is the only other cue, so
  // neither the month nor the rate is available without this label.
  const label = await first.getAttribute('aria-label');
  expect(label).toMatch(/savings rate/i);
  expect(label).toMatch(/%/);

  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('savings-rate-month-detail')).toBeVisible();
});
