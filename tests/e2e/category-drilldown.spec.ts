/**
 * O.5 — clicking a category figure lands on transactions that ADD UP to it.
 *
 * Owner request, 2026-07-27: category figures should link to the transactions
 * behind them "so user can quickly view for accuracy". The unit suite proves the
 * two engines agree on a fixture; this proves the shipped page agrees with the
 * shipped register — that the href the component builds still names the params
 * `transactions/page.tsx` reads, which no pure test can see.
 *
 * The assertion is equality of MONEY, not "the page loaded": a link whose
 * landing page sums to a different number than the figure clicked is worse than
 * no link, and a 200 would prove nothing.
 */
import { expect, test } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

/** "$1,629.44" → 162944. Also handles the register's signed "−$1,629.44". */
function parseCents(text: string): number {
  const negative = /[-−]/.test(text);
  const digits = text.replace(/[^0-9.]/g, '');
  const value = Math.round(Number(digits) * 100);
  return negative ? -value : value;
}

test('Reports: a category figure links to a register that nets to the same amount', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-reports');
  await page.waitForURL('**/reports');
  await expect(page.getByTestId('category-breakdown')).toBeVisible();

  // The top spending category that is actually linkable — selected by testid, NOT
  // by "first link in the card": the uncategorized row is deliberately not a
  // category link but still renders a "review in Inbox" anchor, so a positional
  // locator would grab that one whenever uncategorized tops the breakdown.
  const row = page.locator('[data-testid^="category-link-"]').first();
  await expect(row).toBeVisible();
  const label = await row.getAttribute('aria-label');
  // The amount the reader actually SEES, not the one in the aria-label — a label
  // that had drifted from the printed figure would still reconcile against itself.
  const clickedCents = parseCents(await row.locator('span.tabular-nums').innerText());
  expect(clickedCents).toBeGreaterThan(0); // anti-vacuity: a real figure was read
  expect(label).toContain('view these transactions');

  await row.click();
  await page.waitForURL('**/transactions?category=**');

  // The window must have travelled with the category, or the register would be
  // showing all of history under that category.
  const url = new URL(page.url());
  expect(url.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
  expect(url.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await expect(page.getByTestId('txn-summary')).toBeVisible();
  // Spending is money out NET of money back, which is exactly the Net tile with
  // its sign flipped. Asserting against "Money out" instead would pass only for
  // categories that happen to contain no refunds.
  const netCents = parseCents(await page.getByTestId('summary-net').innerText());
  expect(-netCents).toBe(clickedCents);

  // And the rows the reader came to audit are actually there.
  await expect(page.getByTestId('txn-list')).toBeVisible();

  // The page must not greet a filtered arrival by claiming it shows everything
  // (critic F-10) — and the control the reader needs to get back out is present.
  await expect(page.getByText('Every transaction across all your accounts')).toHaveCount(0);
  await expect(page.getByTestId('txn-clear')).toBeVisible();
  // The category control can DISPLAY the filter it arrived under — the condition
  // the href builder refuses on when it cannot (uncategorized, hidden categories).
  await expect(page.getByTestId('txn-filter-category')).not.toHaveValue('');
});

test('Trends: category movers are deliberately NOT deep-linked (basis mismatch)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-trends');
  await page.waitForURL('**/trends');

  const movers = page.getByTestId('trends-movers');
  await expect(movers).toBeVisible();
  // Anti-vacuity: the card must actually be showing movers, or "no link" is
  // trivially true and this lock would rot into an assertion about an empty box.
  await expect(movers.locator('li')).not.toHaveCount(0);

  // `src/server/trends.ts:22` feeds the movers POSTED rows only (and re-derives a
  // null category from the descriptor at :32), while the register filters neither
  // way — so a month figure here can exceed what the register would show, and a
  // link would land the reader on a DIFFERENT number than the one they clicked.
  // /budgets is excluded for the same POSTED-only reason. Re-adding a link here
  // means first making the two bases agree (which changes displayed money and
  // needs its own slice), so this assertion is the thing that must be confronted.
  await expect(movers.locator('a[href*="/transactions?category="]')).toHaveCount(0);
});
