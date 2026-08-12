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
  // The string is the CURRENT unfiltered greeting ("spending accounts",
  // 2026-08-11) — asserting the absence of copy that no longer exists anywhere
  // would pass vacuously and lock nothing.
  await expect(page.getByText('Every transaction across your spending accounts')).toHaveCount(0);
  await expect(page.getByTestId('txn-clear')).toBeVisible();
  // The category control can DISPLAY the filter it arrived under — the condition
  // the href builder refuses on when it cannot (uncategorized, hidden categories).
  await expect(page.getByTestId('txn-filter-category')).not.toHaveValue('');
});

/**
 * O.6 — the inverse of the assertion that used to live here.
 *
 * This test previously asserted the movers card held NO category link, because
 * `src/server/trends.ts` fed it POSTED-only rows and re-derived a null category
 * from the descriptor, so a figure here could exceed what the register shows.
 * O.6 removed both narrowings, which is exactly the confrontation that assertion
 * existed to force — so it is replaced by its opposite rather than deleted.
 */
test('Trends: a category mover deep-links to the month it was summed over', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-trends');
  await page.waitForURL('**/trends');

  const movers = page.getByTestId('trends-movers');
  await expect(movers).toBeVisible();
  // Anti-vacuity: the card must actually be showing movers, or every assertion
  // below passes over an empty box.
  // `mover-row`, not `li`: since O.18 each mover CONTAINS a list of its own
  // transactions (hidden until expanded, but present in the DOM the moment it is
  // opened once), so counting descendant list items counts the wrong thing. This
  // assertion and the equality below were both silently measuring 23 instead of 6.
  await expect(movers.getByTestId('mover-row')).not.toHaveCount(0);

  // EVERY mover row carries a link — no dead rows (O.6 critic P1-2). The builder
  // briefly refused a figure of $0.00, and on this card that lands on the single
  // most surprising row: a category that fell to nothing is on the page BECAUSE it
  // moved, and sorts first by absolute delta, so it rendered dead beside four live
  // ones. The demo has exactly that row ("Travel · $0.00 vs $489.98 usual"), which
  // is why this count equality is not a formality.
  const rowCount = await movers.getByTestId('mover-row').count();
  await expect(movers.locator('[data-testid^="mover-category-link-"]')).toHaveCount(rowCount);

  // For the reconciliation itself, pick a row with money in it: a $0.00 mover is
  // legitimately linkable but its destination is an empty register, which cannot
  // discriminate a right window from a wrong one.
  const links = await movers.locator('[data-testid^="mover-category-link-"]').all();
  let link = links[0];
  let clickedCents = 0;
  for (const candidate of links) {
    const value = parseCents(await candidate.innerText());
    if (value > 0) {
      link = candidate;
      clickedCents = value;
      break;
    }
  }
  // The link is nailed to `currentCents` — the month total — and NOT to the delta,
  // which is the biggest number on the row and is a difference between two months
  // rather than a sum of any rows.
  expect(clickedCents).toBeGreaterThan(0); // anti-vacuity: a real figure was read

  // The window must be the COMPARED month (the last completed one), not the
  // in-progress month the rest of the page is about. Carrying the wrong month is
  // the one mistake here that still produces a plausible-looking register.
  const href = new URL((await link.getAttribute('href'))!, 'http://localhost');
  const from = href.searchParams.get('from')!;
  expect(href.searchParams.get('to')!.slice(0, 7)).toBe(from.slice(0, 7));
  // The demo clock is pinned (business-today.ts: DEMO_USER_ID → DEFAULT_AS_OF =
  // 2026-06-10), so the last COMPLETED month is May and the link must say so. An
  // in-progress-month window here would be the wrong rows under a right-looking
  // URL, which is why this is pinned rather than merely shape-matched.
  expect(from).toBe('2026-05-01');

  await link.click();
  await page.waitForURL('**/transactions?category=**');
  const netCents = parseCents(await page.getByTestId('summary-net').innerText());
  expect(-netCents).toBe(clickedCents);
  await expect(page.getByTestId('txn-filter-category')).not.toHaveValue('');
});

test('Budgets: a spend figure links to a register that nets to the same amount', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-budgets');
  await page.waitForURL('**/budgets');

  // Selected by testid, not positionally: a row whose figure is $0.00 (a target
  // with no spend yet) is deliberately NOT a link, and rows are sorted by spend
  // so the linkable ones lead — but the testid is what makes that non-accidental.
  const link = page.locator('[data-testid^="budget-category-link-"]').first();
  await expect(link).toBeVisible();
  const clickedCents = parseCents(await link.innerText());
  expect(clickedCents).toBeGreaterThan(0);

  const href = new URL((await link.getAttribute('href'))!, 'http://localhost');
  expect(href.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-01$/);

  await link.click();
  await page.waitForURL('**/transactions?category=**');
  // The whole point of O.6: this equality was FALSE before the basis was unified,
  // by the value of any pending charge in the month.
  const netCents = parseCents(await page.getByTestId('summary-net').innerText());
  expect(-netCents).toBe(clickedCents);
  await expect(page.getByTestId('txn-filter-category')).not.toHaveValue('');
});

/**
 * REGRESSION (owner-reported 2026-07-31, with a /budgets screenshot):
 * *"I should be able to see all transactions under that category."*
 *
 * The figure was a link and the NAME beside it was an inert `<span>`, on the two
 * surfaces (/budgets, /trends) where the figure is the only target. The reader
 * pointed at the words, nothing happened, and the feature read as unshipped.
 *
 * This asserts the property that was missing rather than the markup: the name
 * REACHES the same filtered register as the figure on its row. Fails against the
 * old code at the very first line — no `budget-category-name-link-*` existed.
 */
test('Budgets: the category NAME reaches the same register as its figure', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-budgets');
  await page.waitForURL('**/budgets');

  const nameLink = page.locator('[data-testid^="budget-category-name-link-"]').first();
  await expect(nameLink).toBeVisible();

  // Same row, same destination — the two anchors may not drift into two answers.
  const categoryId = (await nameLink.getAttribute('data-testid'))!.replace(
    'budget-category-name-link-',
    '',
  );
  const figureLink = page.getByTestId(`budget-category-link-${categoryId}`);
  const clickedCents = parseCents(await figureLink.innerText());
  expect(clickedCents).toBeGreaterThan(0); // anti-vacuity: a real figure was read
  expect(await nameLink.getAttribute('href')).toBe(await figureLink.getAttribute('href'));

  // And the name is a target a thumb can actually hit — the whole complaint.
  const box = (await nameLink.boundingBox())!;
  expect(box.width).toBeGreaterThan(60);

  await nameLink.click();
  await page.waitForURL('**/transactions?category=**');
  const netCents = parseCents(await page.getByTestId('summary-net').innerText());
  expect(-netCents).toBe(clickedCents);
  await expect(page.getByTestId('txn-filter-category')).not.toHaveValue('');
});

/**
 * REGRESSION (same report, the "and all bar charts" half): on /reports the BAR
 * was a sibling of the row anchor, so the widest and most chart-like element on
 * the card was the one part that ignored a tap. The bar now sits inside the same
 * anchor. Asserted by hit-testing the bar's own centre point, because the bar is
 * decorative markup with no testid of its own and a DOM-shape assertion would
 * pass on a bar that is visually covered by something else.
 */
test('Reports: tapping the category BAR opens that category', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-reports');
  await page.waitForURL('**/reports');
  await expect(page.getByTestId('category-breakdown')).toBeVisible();

  const row = page.locator('[data-testid^="category-link-"]').first();
  await expect(row).toBeVisible();
  const expectedHref = await row.getAttribute('href');

  // The bar is the last child of the anchor; click its centre, not the row's.
  const bar = row.locator('span.rounded-full').first();
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeGreaterThan(0); // anti-vacuity: a real bar was measured
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await page.waitForURL('**/transactions?category=**');
  expect(new URL(page.url()).pathname + '?' + new URL(page.url()).searchParams.toString()).toBe(
    expectedHref,
  );
});
