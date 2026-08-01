/**
 * O.18b — the Conscious Spending strip's legend amounts expand, in place, to
 * the plan rows behind each bucket.
 *
 * The unit suite (conscious-trace.test.ts) proves the per-bucket traces
 * reconcile to `mapToConsciousBuckets` on engine output. What no pure test can
 * see is the SHIPPED wiring: that the legend prints the trace's own headline,
 * that three panels coexist on one page under distinct testids, and that the
 * panel a reader opens sums to the figure they tapped. Every assertion below
 * compares money the page PAINTS against money the panel PAINTS.
 *
 * Read-only on the shared demo: expanding writes nothing (no engagement calls
 * in these components), so the shared-row rule is not in play.
 */
import { expect, test, type Page } from './helpers/test';

/** "$1,629.44" → 162944. Also handles a signed "−$1,629.44". */
function parseCents(text: string): number {
  const negative = /[-−]/.test(text);
  const digits = text.replace(/[^0-9.]/g, '');
  const value = Math.round(Number(digits) * 100);
  return negative ? -value : value;
}

async function signInDemo(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

const BUCKETS = ['conscious-fixed', 'conscious-savings', 'conscious-guilt-free'] as const;

test('each bucket amount opens a panel whose rows sum to exactly that amount', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/budgets');
  await expect(page.getByTestId('conscious-buckets')).toBeVisible();

  const legendCents: Record<string, number> = {};
  for (const prefix of BUCKETS) {
    const toggle = page.getByTestId(`${prefix}-toggle`);
    await expect(toggle).toBeVisible();
    legendCents[prefix] = parseCents(await toggle.innerText());

    await toggle.click();
    const panel = page.getByTestId(`${prefix}-panel`);
    await expect(panel).toBeVisible();
    // The panel's Total is the trace's own row sum; the figure the reader
    // tapped is the trace's headline. Equal on screen — the penny match.
    expect(parseCents(await page.getByTestId(`${prefix}-sum`).innerText())).toBe(
      legendCents[prefix],
    );
    await expect(page.getByTestId(`${prefix}-reconciled`)).toBeVisible();
  }

  // Anti-vacuity: the fixed bucket on the demo is a real figure made of at
  // least two terms (recurring bills + card payments due), so the lock cannot
  // decay into matching a single trivial row against itself.
  expect(legendCents['conscious-fixed']).toBeGreaterThan(0);
  const fixedRows = page.getByTestId('conscious-fixed-rows').locator('li');
  expect(await fixedRows.count()).toBeGreaterThanOrEqual(2);

  // Guilt-free is the REMAINDER, so its panel is the whole subtraction: its
  // first row is income (positive) and at least one later row subtracts.
  const gfAmounts = await page
    .getByTestId('conscious-guilt-free-rows')
    .locator('[data-testid="conscious-guilt-free-row-amount"]')
    .allInnerTexts();
  expect(gfAmounts.length).toBeGreaterThanOrEqual(4);
  expect(parseCents(gfAmounts[0])).toBeGreaterThan(0);
  expect(gfAmounts.slice(1).some((t) => parseCents(t) < 0)).toBe(true);

  // The #93 partition, asserted from PAINTED money alone: the income the
  // guilt-free panel prints equals the three legend figures added up.
  const incomeCents = parseCents(gfAmounts[0]);
  expect(
    legendCents['conscious-fixed'] +
      legendCents['conscious-savings'] +
      legendCents['conscious-guilt-free'],
  ).toBe(incomeCents);

  // The savings bucket is one row by construction. Both of its states carry an
  // assertion (never a vacuous branch): a $0 from "not set up" must offer the
  // control that sets it (L.29 — the action now renders in the shared panel
  // body); a real figure must not show a control beside a working number.
  const savingsAction = page.getByTestId('conscious-savings-row-action');
  if (legendCents['conscious-savings'] === 0) {
    await expect(savingsAction).toBeVisible();
    await expect(savingsAction).toHaveAttribute('href', '/settings');
  } else {
    await expect(savingsAction).toHaveCount(0);
  }

  // Collapse works and does not disturb the figure (a stale-render tell).
  await page.getByTestId('conscious-fixed-toggle').click();
  await expect(page.getByTestId('conscious-fixed-panel')).toBeHidden();
  expect(parseCents(await page.getByTestId('conscious-fixed-toggle').innerText())).toBe(
    legendCents['conscious-fixed'],
  );
});
