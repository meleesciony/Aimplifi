/**
 * Usability pass, wave 1 (TASKS U.1a) — what the reader actually sees at 380px.
 *
 * Every test here is a defect that was found by LOOKING at the rendered app, on a page that
 * was passing every existing gate: a balance split across two lines, an account name broken
 * mid-word, a disclosure triangle stranded above its own title, a sentence pointing at a
 * section the page no longer renders, two pages with no visible title, a screen of dropdowns
 * before the first transaction. The assertions are geometric on purpose — each of these was
 * invisible to a text assertion, which is how they shipped.
 *
 * Source-level halves of the same rules: `tests/unit/usability-pass.test.ts`.
 */
import { type Locator, type Page, expect, test } from './helpers/test';
import { openActivityFilters } from './helpers/activity-filters';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

/** How many line boxes each space-separated word of `el`'s own text occupies. 1 = intact. */
async function lineBoxesPerWord(el: Locator): Promise<number[]> {
  return el.evaluate((node) => {
    const text = node.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('expected a text node');
    const out: number[] = [];
    let at = 0;
    for (const word of (text.textContent ?? '').split(' ')) {
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + word.length);
      out.push(range.getClientRects().length);
      at += word.length + 1;
    }
    return out;
  });
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no bounding box');
  return b;
}

/**
 * The top edge of each selector's first match, read in ONE evaluate. Two `boundingBox()`
 * calls are two round trips, and a page still settling between them (a chapter opening, a
 * streamed card landing) moves one element after the other was measured — this spec's own
 * chapter test flaked on a 136px "offset" that was really a stale first reading. A
 * comparison of two positions has to come from a single layout.
 */
async function topsOf(page: Page, ...selectors: string[]): Promise<number[]> {
  return page.evaluate((sels) => {
    return sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element for ${sel}`);
      return el.getBoundingClientRect().top;
    });
  }, selectors);
}

test('forecast: the page is titled, and no milestone balance is split across lines', async ({ page }) => {
  await signIn(page);
  await page.goto('/forecast');

  // `toBeVisible` passes for an sr-only h1 (a 1×1 clipped box), so measure it.
  const title = page.getByRole('heading', { level: 1, name: 'Cash-flow forecast' });
  expect((await box(title)).height).toBeGreaterThan(20);

  const amounts = page.getByTestId('forecast-milestones').locator('p.tabular-nums');
  await expect(amounts).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const a = amounts.nth(i);
    await expect(a).toHaveText(/^-?\$[\d,]+\.\d{2}$/);
    // "$12,495.0" / "0" was two line boxes for one figure.
    expect(await lineBoxesPerWord(a), await a.innerText()).toEqual([1]);
  }

  // The demo's balances are short. A seven-digit negative is the widest figure the tile
  // must take, and 640px is where the sidebar appears and the content column is narrowest
  // again (critic cycle 2: three tiles there let it cross the tile's border). Stand the
  // long figure in and measure it at both widths: one line, inside its own tile.
  for (const width of [380, 640]) {
    await page.setViewportSize({ width, height: 800 });
    const fits = await page.getByTestId('forecast-milestone').evaluateAll((tiles) =>
      tiles.map((tile) => {
        const amount = tile.querySelector('[data-testid="forecast-milestone-amount"]') as HTMLElement;
        amount.textContent = '-$1,234,567.89';
        const range = document.createRange();
        range.selectNodeContents(amount);
        const text = range.getBoundingClientRect();
        const box = tile.getBoundingClientRect();
        return { lines: range.getClientRects().length, inside: text.left >= box.left && text.right <= box.right };
      }),
    );
    expect(fits, `at ${width}px`).toEqual([
      { lines: 1, inside: true },
      { lines: 1, inside: true },
      { lines: 1, inside: true },
    ]);
  }
});

test('recurring: the page is titled', async ({ page }) => {
  await signIn(page);
  await page.goto('/recurring');
  const title = page.getByRole('heading', { level: 1, name: 'Recurring & subscriptions' });
  expect((await box(title)).height).toBeGreaterThan(20);
});

test('activity: the first transaction is on the first screen, behind one Filters control', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');

  // Folded by default on an unfiltered register…
  const toggle = page.getByTestId('txn-filters-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('txn-filter-type')).toBeHidden();
  // …while search stays out. (The Needs-a-category chip stays out too, but it is hidden at
  // a zero count by design and the shared demo's count is drained by phase2-triage — its
  // own specs cover it; asserting it here made this test depend on run order.)
  await expect(page.getByTestId('txn-search')).toBeVisible();
  // A tap target, like every other control in the bar.
  expect((await box(toggle)).height).toBeGreaterThanOrEqual(44);

  // …so the first row clears the fixed bottom nav with room to read it. Before the fold it
  // began under the nav: a full screen of dropdowns came first.
  await expect(page.getByTestId('txn-row').first()).toBeVisible();
  const [firstRowTop, navTop] = await topsOf(page, '[data-testid="txn-row"]', '[data-testid="bottom-nav"]');
  expect(firstRowTop + 44).toBeLessThan(navTop);

  // The control opens the same selects, and they still filter.
  await openActivityFilters(page);
  await expect(page.getByTestId('txn-filter-type')).toBeVisible();
  await page.getByTestId('txn-filter-type').selectOption('income');
  await expect(page).toHaveURL(/type=income/, { timeout: 20_000 });
  // Stays open, and says how many of the folded axes are on.
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('txn-filters-active-count')).toHaveText('· 1 on');
  // No horizontal overflow with the two-column grid open.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(1);
});

test('activity: arriving already filtered shows which filter, without a tap', async ({ page }) => {
  await signIn(page);
  // The page lead says "the controls below say which" — a folded bar would make that false.
  await page.goto('/transactions?spendClass=fixed');
  await expect(page.getByTestId('txn-filters-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('txn-filter-spend-class')).toBeVisible();
  await expect(page.getByTestId('txn-filter-spend-class')).toHaveValue('fixed');
  await expect(page.getByTestId('txn-filters-active-count')).toHaveText('· 1 on');
});

test('activity: an empty register offers no Filters control — there is nothing to filter', async ({ page }) => {
  // A brand-new account, not the demo: zero transactions and nothing applied. The toggle
  // would open seven selects that can only return nothing (critic cycle 2, P2-4).
  const email = `e2e-uxpass-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  await page.goto('/transactions');
  await expect(page.getByTestId('txn-empty')).toBeVisible();
  await expect(page.getByTestId('txn-search')).toBeVisible();
  await expect(page.getByTestId('txn-filters-toggle')).toHaveCount(0);

  // …but a set FILTERED to empty keeps it, open: that is where the reader needs the way out.
  await page.goto('/transactions?type=income');
  await expect(page.getByTestId('txn-filters-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('txn-filter-type')).toBeVisible();
});

test('activity: from sm up the bar is unchanged — no toggle, every select out', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-filters-toggle')).toBeHidden();
  for (const id of ['txn-filter-type', 'txn-filter-account', 'txn-filter-category', 'txn-filter-spend-class', 'txn-filter-period']) {
    await expect(page.getByTestId(id), id).toBeVisible();
  }
});

test('activity: an account name wraps at a space, never inside a word', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');
  // "Sapphire Card" rendered as "Sap" / "phire Card" under `break-all`.
  const name = page.getByTestId('txn-row').getByText('Sapphire Card', { exact: true }).first();
  await expect(name).toBeVisible();
  expect(await lineBoxesPerWord(name)).toEqual([1, 1]);
});

test('home: recent rows show a date a person would write, and the feed says where to find its subject', async ({ page }) => {
  await signIn(page);

  const recent = page.getByTestId('dashboard-recent-transactions');
  await expect(recent.getByTestId('dashboard-recent-row').first()).toBeVisible();
  // The demo branch printed the stored value: "2026-06-10".
  await expect(recent).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  await expect(recent.getByTestId('home-recent-date-text').first()).toHaveText(
    /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{4}$/,
  );

  // Four rows said "Details in Recurring below." — Home renders no Recurring section.
  const feed = page.getByTestId('today-feed-card');
  await expect(feed).not.toContainText('Recurring below');
  // These rows name no merchant, so the link has to land where the subject IS named, with
  // the row's own figure beside it. Whichever recurring-detector row is on screen will do —
  // the four kinds share one destination.
  const row = feed.locator('[data-testid^="nudge-"]:has([data-testid^="nudge-route-link-"])').first();
  await expect(row).toBeVisible();
  const figure = ((await row.textContent()) ?? '').match(/\$[\d,]+\.\d{2}\/mo/)?.[0];
  expect(figure, 'the row states a monthly figure').toBeTruthy();
  const link = row.locator('[data-testid^="nudge-route-link-"]');
  await expect(link).toHaveAttribute('href', '/coach#worth-a-look');
  await link.click();
  await page.waitForURL('**/coach#worth-a-look');
  const list = page.getByTestId('opportunities-list');
  await expect(list.getByTestId('coach-opportunity-link').first()).toBeVisible();
  await expect(list).toContainText(figure!);
  // …and it lands ON the card: /coach's first screen is the next-dollar card, and the list
  // that answers "which one?" starts below the fold without the anchor.
  await expect(page.getByTestId('opportunities-card')).toBeInViewport();
  await expect(page.locator('#worth-a-look')).toHaveCount(1);
});

test('chapter titles sit on the same line as their disclosure triangle', async ({ page }) => {
  await signIn(page);
  for (const [route, testid] of [
    ['/dashboard', 'home-chapter-home-picture'],
    ['/coach', 'coach-chapter-coach-trajectory'],
  ] as const) {
    await page.goto(route);
    const summary = page.getByTestId(testid).locator(':scope > summary');
    await expect(summary).toBeVisible();
    // As a block the h2 started a full line (~24px) below the summary's top, leaving the
    // triangle alone on the first line. Both edges from one layout (see `topsOf`).
    const offset = await summary.evaluate((s) => {
      const h = s.querySelector('h2');
      if (!h) throw new Error('chapter summary has no h2');
      return h.getBoundingClientRect().top - s.getBoundingClientRect().top;
    });
    expect(offset, `${testid}: title offset from the summary's first line`).toBeLessThan(8);
    // …and the triangle is still the browser's own (home/coach-chapters specs pin this too).
    expect(await summary.evaluate((el) => getComputedStyle(el).listStyleType)).toMatch(/disclosure|disc/);
  }
});

test('coach: a closed rest shows that it opens, and the chevron turns when it does', async ({ page }) => {
  await signIn(page);
  await page.goto('/coach');
  const rest = page.getByTestId('next-dollar-more');
  const chevron = rest.locator(':scope > summary').getByTestId('disclosure-chevron');
  await expect(chevron).toBeVisible();
  const turned = () => chevron.evaluate((el) => getComputedStyle(el).rotate !== 'none' || getComputedStyle(el).transform !== 'none');
  expect(await turned()).toBe(false);
  await rest.locator(':scope > summary').click();
  await expect(rest).toHaveAttribute('open', '');
  await expect.poll(turned).toBe(true);
});

test('guilt-free: the limits fold under a line that keeps their consequence; the bases stay out', async ({ page }) => {
  await signIn(page);
  await page.goto('/spending-plan');

  // The sum, its penny check, and the per-line bases are all on screen. The bases were
  // folded in this slice's first cut and its critic sent that back: two of them are the
  // page's only answer to "where did my card payment go?" (spending-plan.spec and
  // spending-plan-month-edge.spec require them visible; this is the same rule, stated here
  // so the next pass that wants to shorten this page meets it first).
  await expect(page.getByTestId('plan-reconciled')).toBeVisible();
  await expect(page.getByText(/Card statement payments are not subtracted here/i)).toBeVisible();
  await expect(page.getByText(/Discretionary spending is never subtracted/i)).toBeVisible();

  // "What this figure can't see": closed, but the CONSEQUENCE is on the summary line —
  // the reader meets "may be lower than shown" without opening anything. The summary does
  // not restate the three rules (two attempts to compress them were each wrong — critic
  // cycles 1 and 2); it says such cases exist, how many notes are inside, and what they
  // share. So the count it states is pinned to the notes it counts.
  const cantSee = page.getByTestId('spending-plan-disclosures');
  await expect(cantSee).not.toHaveAttribute('open', '');
  const summary = page.getByTestId('plan-cant-see-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveText(
    /^Some repeating bills can go uncounted here — the three notes inside say which — so the real (amount free to spend may be lower|overage may be higher) than shown\.$/,
  );
  await expect(cantSee.locator('ul > li')).toHaveCount(3);
  await expect(page.getByTestId('plan-unrecognized-cadence-note')).toBeHidden();
  await cantSee.locator(':scope > summary').click();
  await expect(page.getByTestId('plan-unrecognized-cadence-note')).toBeVisible();
  await expect(page.getByTestId('plan-long-cadence-overdue-note')).toBeVisible();
});

test('settings: the index reaches every section it lists', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  const links = page.getByTestId('settings-index-link');
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(14);

  // Every link names an element that exists — no dead ends.
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  for (const href of hrefs) {
    expect(href).toMatch(/^#[a-z-]+$/);
    await expect(page.locator(href), href).toHaveCount(1);
  }

  // …and tapping the last one brings the section it names onto the screen.
  await links.filter({ hasText: 'Delete my data' }).click();
  await expect(page).toHaveURL(/#delete-data$/);
  await expect(page.getByTestId('privacy-card')).toBeInViewport();
});

test('inbox: the card to file comes before the scorecard, and the lead has room to read', async ({ page }) => {
  await signIn(page);
  await page.goto('/triage');
  // The queue is EITHER a card to file or "Inbox zero" — phase2-triage drains the shared
  // demo's queue by contract, so which one renders depends on run order. The claim is about
  // the queue's place on the page, and both states are the queue.
  const QUEUE = '[data-testid="triage-card"], [data-testid="triage-empty"]';
  await expect(page.locator(QUEUE).first()).toBeVisible();
  await expect(page.getByTestId('accuracy-card')).toBeVisible();
  const [queueTop, accuracyTop] = await topsOf(page, QUEUE, '[data-testid="accuracy-card"]');
  expect(queueTop).toBeLessThan(accuracyTop);
  // The lead shared a row with the button and was squeezed to ~170px.
  expect((await box(page.getByTestId('inbox-subtitle'))).width).toBeGreaterThan(300);
});
