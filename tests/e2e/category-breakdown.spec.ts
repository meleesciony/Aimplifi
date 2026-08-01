/**
 * O.18 — a category row expands, in place, to the transactions inside it.
 *
 * Owner request, 2026-07-31: *"make rows expandable so I can see what exactly
 * system is classifying spending as. Not just the stuff in the photo but every
 * table."*
 *
 * The unit suite proves the builder and the figure engine agree on a fixture.
 * What no pure test can see is whether the SHIPPED page hands the panel the
 * figure it actually prints — the panel takes a headline from its call site, and
 * a call site that passed the wrong one (a target instead of a spend, a delta
 * instead of a month total) would still render a self-consistent panel. So every
 * assertion below reads the money the page PAINTS and compares it against the
 * money the panel PAINTS, on all three surfaces.
 *
 * Anti-vacuity is explicit throughout: each test asserts a non-zero figure and
 * at least one listed row before comparing them, so a page that rendered an
 * empty breakdown could not pass by matching $0.00 against $0.00 (the
 * assert-the-hard-case-is-present rule).
 */
import { expect, test, type Page } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

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

/**
 * The first row on the page whose figure is a real amount, and the first whose
 * figure is zero.
 *
 * Both halves matter and the first draft of this spec had only one, which is how
 * it failed: it took the topmost mover, and on the demo seed that is Travel at
 * **$0.00** — a category that fell to nothing, which `links.ts` calls "the most
 * interesting row there". A zero figure explained by zero rows is CORRECT and
 * reconciles, but comparing $0.00 against $0.00 proves nothing about the wiring,
 * so the reconciliation assertion needs a live figure and the empty-state
 * assertion needs the zero. Selecting each by VALUE rather than by position also
 * survives a re-sort.
 *
 * `readFigure` is passed in because each surface prints its amount in a
 * different element — that difference is part of what is being checked.
 */
async function partitionRowsByFigure(
  page: Page,
  testIdPrefix: string,
  readFigure: (locator: ReturnType<Page['locator']>) => Promise<string>,
): Promise<{ live: { categoryId: string; cents: number } | null; zero: string | null }> {
  const links = page.locator(`[data-testid^="${testIdPrefix}"]`);
  const count = await links.count();
  let live: { categoryId: string; cents: number } | null = null;
  let zero: string | null = null;
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const categoryId = (await link.getAttribute('data-testid'))!.replace(testIdPrefix, '');
    const cents = parseCents(await readFigure(link));
    if (cents > 0 && live === null) live = { categoryId, cents };
    if (cents === 0 && zero === null) zero = categoryId;
  }
  return { live, zero };
}

/**
 * Open one panel and prove it explains the figure beside it.
 *
 * `printedCents` is read from the row by the caller, because each surface prints
 * its figure in a different element — that difference is precisely the thing
 * being checked, so it cannot be abstracted away.
 */
async function expectPanelExplains(
  page: Page,
  prefix: string,
  categoryId: string,
  printedCents: number,
) {
  const panel = page.getByTestId(`${prefix}-panel-${categoryId}`);
  const toggle = page.getByTestId(`${prefix}-toggle-${categoryId}`);

  // Closed until asked: the answer opens in place, it is not always on screen.
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // The hard case must be present, or the equality below is $0.00 = $0.00.
  const rows = panel.getByTestId(`${prefix}-rows-${categoryId}`).locator('li');
  expect(await rows.count()).toBeGreaterThan(0);
  expect(printedCents).toBeGreaterThan(0);

  // The claim: the rows this panel lists add up to the figure the page printed.
  const sumCents = parseCents(await page.getByTestId(`${prefix}-sum-${categoryId}`).innerText());
  expect(sumCents).toBe(printedCents);
  // …and the panel says so in its own words, rather than leaving the reader to
  // add the column up. The mismatch branch must NOT be the one that rendered.
  await expect(page.getByTestId(`${prefix}-reconciled-${categoryId}`)).toBeVisible();
  await expect(page.getByTestId(`${prefix}-mismatch-${categoryId}`)).toHaveCount(0);

  // It closes again — an expander that only opens is a layout bug on a phone.
  await toggle.click();
  await expect(panel).toBeHidden();
}

test('Budgets: a category row expands to the transactions that make up its figure', async ({
  page,
}) => {
  await signInDemo(page);
  await clickMoreNav(page, 'nav-budgets');
  await page.waitForURL('**/budgets');
  await expect(page.getByTestId('budget-list')).toBeVisible();

  // A category with real spend, chosen by VALUE: the uncategorized row is
  // deliberately not a link, and a row can exist with a target and no spend.
  const { live } = await partitionRowsByFigure(page, 'budget-category-link-', (l) => l.innerText());
  expect(live).not.toBeNull();

  await expectPanelExplains(page, 'budget-breakdown', live!.categoryId, live!.cents);
});

test('Reports: a category bar expands to the transactions behind it', async ({ page }) => {
  await signInDemo(page);
  await clickMoreNav(page, 'nav-reports');
  await page.waitForURL('**/reports');
  await expect(page.getByTestId('category-breakdown')).toBeVisible();

  const { live } = await partitionRowsByFigure(page, 'category-link-', (l) =>
    l.locator('span.tabular-nums').innerText(),
  );
  expect(live).not.toBeNull();

  await expectPanelExplains(page, 'reports-breakdown', live!.categoryId, live!.cents);
});

test('Trends: a mover expands to the transactions in the month it compares', async ({ page }) => {
  await signInDemo(page);
  await clickMoreNav(page, 'nav-trends');
  await page.waitForURL('**/trends');
  await expect(page.getByTestId('trends-movers')).toBeVisible();

  const { live, zero } = await partitionRowsByFigure(page, 'mover-category-link-', (l) =>
    l.innerText(),
  );
  expect(live).not.toBeNull();
  // The demo seed is golden, and it carries BOTH shapes on this card (a category
  // that grew, and Travel which fell to $0.00). Asserting the zero one is present
  // is what stops the empty-state check below from silently going vacuous.
  expect(zero).not.toBeNull();

  // A mover that fell to nothing is the row a reader most wants explained, and
  // its honest panel is an EMPTY one. It must say so in words rather than
  // rendering an empty box or claiming a mismatch.
  await page.getByTestId(`mover-breakdown-toggle-${zero}`).click();
  await expect(page.getByTestId(`mover-breakdown-empty-${zero}`)).toBeVisible();
  await expect(page.getByTestId(`mover-breakdown-mismatch-${zero}`)).toHaveCount(0);
  await page.getByTestId(`mover-breakdown-toggle-${zero}`).click();

  // The window is the load-bearing part on this page: the panel must describe
  // `comparedYm`, the LAST COMPLETE month, not the in-progress one the pace card
  // above it talks about. The register link inside the panel carries that month,
  // so it is the assertion available to a browser.
  const categoryId = live!.categoryId;
  await expectPanelExplains(page, 'mover-breakdown', categoryId, live!.cents);

  await page.getByTestId(`mover-breakdown-toggle-${categoryId}`).click();
  const registerLink = page.getByTestId(`mover-breakdown-register-${categoryId}`);
  const href = await registerLink.getAttribute('href');
  const params = new URL(href!, 'http://localhost').searchParams;
  expect(params.get('category')).toBe(categoryId);
  // DEMO_TODAY is pinned to 2026-06-10 by the e2e env, so the compared month is May.
  expect(params.get('from')).toBe('2026-05-01');
  expect(params.get('to')).toBe('2026-05-31');
});

test('the panel states what it counts, and every row can be opened for a closer look', async ({
  page,
}) => {
  await signInDemo(page);
  await clickMoreNav(page, 'nav-budgets');
  await page.waitForURL('**/budgets');
  // `partitionRowsByFigure` counts matches once, so it must not run against a
  // half-painted page — a bare `waitForURL` returned zero rows here and the
  // helper reported "no live figure" for a page that has plenty.
  await expect(page.getByTestId('budget-list')).toBeVisible();

  const { live } = await partitionRowsByFigure(page, 'budget-category-link-', (l) => l.innerText());
  expect(live).not.toBeNull();
  const categoryId = live!.categoryId;
  await page.getByTestId(`budget-breakdown-toggle-${categoryId}`).click();
  const panel = page.getByTestId(`budget-breakdown-panel-${categoryId}`);
  await expect(panel).toBeVisible();

  // The basis is printed by the component itself, so no surface can ship a panel
  // with no disclosure by forgetting a prop.
  await expect(panel).toContainText('Pending charges are included');

  // A row leads somewhere a misfiling can be corrected — the reason the reader
  // opened the panel in the first place.
  const firstRowLink = panel.locator('a[href^="/transactions/"]').first();
  await expect(firstRowLink).toBeVisible();
  await firstRowLink.click();
  await page.waitForURL('**/transactions/**');
});
