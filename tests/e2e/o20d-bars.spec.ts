/**
 * O.20d — the owner's standing request, "every single bar and collection of
 * categories needs to be immediately available": the remaining non-drillable
 * bars/charts are now real controls, each opening a BreakdownPanel behind it.
 *
 * The unit locks prove the ROWS are the ones the figure was summed from
 * (Σ rows === figure by construction, carried out of the same loop). This file
 * proves the GESTURE on all five surfaces:
 *
 *   /coach      — the lifestyle-creep strip: a bar opens the month's purchases
 *   /dashboard  — net-worth trend: a point chip opens the account constituents
 *   /forecast   — a day chip opens the scheduled flows that move the line that day
 *   /investments— an allocation segment opens the accounts holding that symbol
 *   /investments— a retirement year bar opens the REFUSAL panel (a projection
 *                 has no rows, and the panel says so instead of inventing any)
 *
 * Runs as the demo (read-only drill-downs that create nothing), the only
 * fixture with the months of history these charts are drawn from.
 */
import { type Page, expect, test } from './helpers/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('a creep bar opens the discretionary purchases that month was summed from', async ({ page }) => {
  await signIn(page);
  await page.goto('/coach');

  const card = page.getByTestId('creep-card');
  await expect(card).toBeVisible();

  // The fixture's hard case: there are bars to press. Six months of window
  // always render, but a regression dropping them would let every assertion
  // below pass by never running.
  const bars = card.locator('[data-testid^="creep-bar-"]');
  await expect(bars.first()).toBeVisible();
  const count = await bars.count();
  expect(count).toBeGreaterThan(1);

  // Nothing is expanded until the reader asks.
  await expect(page.locator('[data-testid^="creep-bar-panel-"]')).toHaveCount(0);

  const first = bars.first();
  const month = (await first.getAttribute('data-testid'))!.replace('creep-bar-', '');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');

  const panel = page.getByTestId(`creep-bar-panel-${month}`);
  await expect(panel).toBeVisible();
  // The engine-composed basis sentence — what counts here, named inline.
  await expect(panel).toContainText('discretionary spending');

  // The purchases behind the figure — or the $0.00 month's empty copy, never
  // nothing. (The penny-match itself is unit-locked; this proves the rows RENDER.)
  const rows = panel.locator('[data-testid^="creep-bar-rows-"]');
  const empty = panel.locator('[data-testid^="creep-bar-empty-"]');
  await expect(rows.or(empty)).toBeVisible();
  if ((await rows.count()) > 0) {
    await expect(panel.locator('[data-testid^="creep-bar-sum-"]')).toBeVisible();
    await expect(panel.locator('[data-testid^="creep-bar-reconciled-"]')).toBeVisible();
  }

  // The panel offers the month in the activity list, where a row can be re-filed.
  const register = panel.locator('[data-testid^="creep-bar-register-"]');
  await expect(register).toHaveAttribute('href', /\/transactions\?from=/);

  // Hiding from INSIDE the panel must clear the bar's expanded state too —
  // the two controls cannot announce different things (critic P2-1). (The
  // panel's toggle is its SIBLING, outside the region.)
  await page.getByTestId(`creep-bar-toggle-${month}`).click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  // …and the Hide unmounts the panel the toggle lives in, so focus must land
  // back on the bar — not <body>, which a keyboard user cannot see (O.20f P2-d).
  await expect(first).toBeFocused();

  // It is a toggle, not a one-way door: the bar re-opens it…
  await first.click();
  await expect(page.getByTestId(`creep-bar-panel-${month}`)).toBeVisible();
  // …and closes it again.
  await first.click();
  await expect(page.getByTestId(`creep-bar-panel-${month}`)).toHaveCount(0);
});

test('creep bars are reachable by keyboard and name their month and amount', async ({ page }) => {
  await signIn(page);
  await page.goto('/coach');

  const first = page.getByTestId('creep-card').locator('[data-testid^="creep-bar-"]').first();
  // The drawn height is data-scaled and colour is the only other cue, so
  // neither the month nor the amount is available without this label.
  const label = await first.getAttribute('aria-label');
  expect(label).toMatch(/\w{3} 20\d\d/);
  expect(label).toMatch(/\$\d[\d,]*\.\d{2}/);

  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
});

test('a net-worth point chip opens the account constituents it was summed from', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard');

  const chips = page.getByTestId('net-worth-points').locator('[data-testid^="net-worth-point-"]');
  await expect(chips.first()).toBeVisible();
  expect(await chips.count()).toBeGreaterThan(1);

  // The month-end point: its basis says what a month-end point is made of.
  await chips.first().click();
  const monthEnd = page.getByTestId(`net-worth-constituents-panel-${(await chips.first().getAttribute('data-testid'))!.replace('net-worth-point-', '')}`);
  await expect(monthEnd).toBeVisible();
  await expect(monthEnd).toContainText('assets minus liabilities');
  const rows = monthEnd.locator('[data-testid^="net-worth-constituents-rows-"]');
  await expect(rows).toBeVisible();
  await expect(monthEnd.locator('[data-testid^="net-worth-constituents-sum-"]')).toBeVisible();
  await expect(monthEnd.locator('[data-testid^="net-worth-constituents-reconciled-"]')).toBeVisible();
  // The rows are ACCOUNTS, not transactions — the region must not call them
  // that (critic P1-2).
  await expect(monthEnd).toHaveAttribute('aria-label', /^Accounts in Net worth/);

  // The "Today" chip is the LIVE point — a different basis sentence, because
  // live balances are a different thing from month-end snapshots.
  const today = chips.last();
  await expect(today).toHaveText('Today');
  await today.click();
  const livePanel = page.getByTestId(`net-worth-constituents-panel-${(await today.getAttribute('data-testid'))!.replace('net-worth-point-', '')}`);
  await expect(livePanel).toBeVisible();
  await expect(livePanel).toContainText('live balance');

  // Inner Hide: focus returns to the chip that opened it (O.20f P2-d).
  const liveDate = (await today.getAttribute('data-testid'))!.replace('net-worth-point-', '');
  await page.getByTestId(`net-worth-constituents-toggle-${liveDate}`).click();
  await expect(livePanel).toHaveCount(0);
  await expect(today).toBeFocused();
});

test('the /accounts net-worth trend opens the same drilldown (second surface)', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');

  const chips = page
    .getByTestId('accounts-net-worth-points')
    .locator('[data-testid^="accounts-net-worth-point-"]');
  await expect(chips.first()).toBeVisible();
  await chips.first().click();
  await expect(
    page.locator('[data-testid^="accounts-net-worth-constituents-panel-"]').first(),
  ).toBeVisible();
});

test('a forecast day chip opens the scheduled flows that move the line that day', async ({ page }) => {
  await signIn(page);
  await page.goto('/forecast');

  // The fixture's hard case: days with scheduled flows exist to press. A
  // forecast with zero flow days would let every assertion pass by never
  // running — the engine guarantees chips exactly for event days.
  const chips = page.getByTestId('forecast-flow-days').locator('[data-testid^="forecast-day-chip-"]');
  await expect(chips.first()).toBeVisible();
  expect(await chips.count()).toBeGreaterThan(0);

  await chips.first().click();
  const panel = page.locator('[data-testid^="forecast-day-panel-"]').first();
  await expect(panel).toBeVisible();
  // Rows are guaranteed: a chip exists only for a day that HAS events.
  await expect(panel.locator('[data-testid^="forecast-day-rows-"] li').first()).toBeVisible();
  await expect(panel.locator('[data-testid^="forecast-day-sum-"]')).toBeVisible();
  // The honest sentence: the balance line is cumulative, so these rows are the
  // day's CHANGE, never the balance shown on the chart.
  await expect(panel).toContainText('cumulative');
  await expect(panel).toContainText('never add up to the balance');

  // Inner Hide: focus returns to the chip that opened it (O.20f P2-d).
  const day = (await chips.first().getAttribute('data-testid'))!.replace('forecast-day-chip-', '');
  await page.getByTestId(`forecast-day-toggle-${day}`).click();
  await expect(panel).toHaveCount(0);
  await expect(chips.first()).toBeFocused();
});

test('an allocation segment opens the accounts holding that symbol', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');

  const group = page.getByTestId('investments-allocation');
  const segments = group.locator('[data-testid^="allocation-segment-"]');
  await expect(segments.first()).toBeVisible();
  expect(await segments.count()).toBeGreaterThan(1); // the demo holds several symbols

  await segments.first().click();
  const panel = page.locator('[data-testid^="allocation-panel-"]').first();
  await expect(panel).toBeVisible();
  // Per-account rows — a symbol held in two accounts reads as two rows that sum
  // to the segment (Σ locked in unit; this proves they render).
  await expect(panel.locator('[data-testid^="allocation-rows-"] li').first()).toBeVisible();
  await expect(panel.locator('[data-testid^="allocation-sum-"]')).toBeVisible();
  await expect(panel.locator('[data-testid^="allocation-reconciled-"]')).toBeVisible();
  await expect(panel).toContainText('market value');
  // The rows are ACCOUNTS, not transactions — the region must not call them
  // that (critic P1-2).
  await expect(panel).toHaveAttribute('aria-label', /^Accounts in/);

  // Inner Hide: focus returns to the legend entry that opened it (O.20f P2-d).
  const symbol = (await segments.first().getAttribute('data-testid'))!.replace('allocation-segment-', '');
  await page.getByTestId(`allocation-toggle-${symbol}`).click();
  await expect(panel).toHaveCount(0);
  await expect(segments.first()).toBeFocused();
});

test('a retirement year bar opens the refusal panel — a projection has no rows', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');

  const bars = page.getByTestId('retirement-outlook').locator('[data-testid^="retirement-bar-"]');
  await expect(bars.first()).toBeVisible();
  expect(await bars.count()).toBeGreaterThan(1); // age 40..plan-through, at least the saving years

  // The FIRST bar is the CURRENT portfolio (age = currentAge), not a
  // projection — its refusal must say exactly that, and never "no transactions
  // or holdings make it up" (critic P1-1: the five holdings DO make it up).
  await bars.first().click();
  const currentPanel = page.locator('[data-testid^="retirement-bar-panel-"]').first();
  await expect(currentPanel).toBeVisible();
  await expect(currentPanel.locator('[data-testid^="retirement-bar-empty-"]')).toContainText(
    'is your current portfolio — the combined balance of your investment accounts today, not a projection',
  );
  await expect(currentPanel).not.toContainText('no transactions or holdings make it up');
  // Re-review F3: this figure totals ACCOUNT BALANCES, while the page headlines
  // "Portfolio value" from what the HOLDINGS mark to. The seed makes them equal,
  // so only the basis sentence can prove the panel stopped claiming they are the
  // same number.
  await expect(currentPanel).toContainText('balances your investment accounts report');
  await expect(currentPanel).toContainText('so the two can differ');

  // A LATER bar (the seeded retirement age, 65) IS a projection — the refusal
  // says so, and states the assumptions behind it, the same engine-composed
  // sentence the card's footnote shows — two surfaces cannot drift.
  // (Typographic apostrophes: the sentence renders `you’re` / `today’s`,
  // matching the `&rsquo;` the card footnote always rendered.)
  await page.getByTestId('retirement-bar-65').click();
  const projectionPanel = page.getByTestId('retirement-bar-panel-65');
  await expect(projectionPanel).toBeVisible();
  await expect(projectionPanel.locator('[data-testid^="retirement-bar-empty-"]')).toContainText(
    'is a projection — no transactions or holdings make it up',
  );
  await expect(projectionPanel).toContainText('Assumes you’re 40 today');
  await expect(projectionPanel).toContainText('in today’s dollars');

  // Inner Hide: focus returns to the bar that opened it (O.20f P2-d).
  await page.getByTestId('retirement-bar-toggle-65').click();
  await expect(projectionPanel).toHaveCount(0);
  await expect(page.getByTestId('retirement-bar-65')).toBeFocused();
});
