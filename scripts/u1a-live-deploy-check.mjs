/**
 * Deploy proof for U.1a (usability pass, wave 1 — DECISIONS #778), run against
 * PRODUCTION (www.aimplifi.app). Node type: live probe (GRAPH.md §6).
 *
 * The proof rests on things a pre-U.1a build cannot produce: the Filters toggle, the
 * Settings index, the disclosure chevrons, the visible page titles, the one-row
 * forecast milestones, the feed's Coach links, the queue ahead of the scorecard. A
 * stale deployment answers 200 and fails every one of those. One check is a guard
 * rather than a discriminator and says so: the Guilt-free bases staying on screen
 * (true before U.1a as well — it guards the fold this slice tried and reverted).
 *
 * Read-only: one-click demo sign-in and page reads at 380px. Writes nothing.
 *
 *   node scripts/u1a-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Line boxes per space-separated word of an element's own text. 1 = on one line. */
const lineBoxesPerWord = (locator) =>
  locator.evaluate((node) => {
    const text = node.firstChild;
    const out = [];
    let at = 0;
    for (const word of (text?.textContent ?? '').split(' ')) {
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + word.length);
      out.push(range.getClientRects().length);
      at += word.length + 1;
    }
    return out;
  });

const browser = await chromium.launch();
// Pixel 5 so the page sees a touch device (the tap-target floor is `pointer: coarse`).
const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 380, height: 800 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  let signedIn = false;
  let lastErr = '';
  for (let i = 0; i < 3 && !signedIn; i++) {
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('demo-sign-in').click({ timeout: 15000 });
      await page.waitForURL('**/dashboard', { timeout: 45000 });
      signedIn = true;
    } catch (e) {
      lastErr = String(e).split('\n')[0];
    }
  }
  check('demo: one-click sign-in reached the dashboard', signedIn, signedIn ? '' : lastErr);
  if (!signedIn) throw new Error(`demo sign-in failed after retries: ${lastErr}`);

  /* ── Home ── */
  await page.getByTestId('dashboard-recent-transactions').waitFor({ timeout: 30000 });
  const recentText = (await page.getByTestId('dashboard-recent-transactions').textContent()) ?? '';
  check('home: recent rows print no stored-form date (YYYY-MM-DD)', !/\d{4}-\d{2}-\d{2}/.test(recentText));
  const feedText = (await page.getByTestId('today-feed-card').textContent()) ?? '';
  check('home: the feed no longer says "Recurring below"', !feedText.includes('Recurring below'));
  // The demo carries recurring-detector rows and its dismissals are a no-op
  // (`recordNudgeDismissal` refuses the demo user), so at least one MUST be on screen —
  // `every` over an empty list would pass on a build that has no such link at all.
  const routeLinks = page.locator('[data-testid^="nudge-route-link-"]');
  const routeCount = await routeLinks.count();
  const hrefs = await routeLinks.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  check(
    'home: every recurring-detector row links to Coach, which lists it by name',
    routeCount > 0 && hrefs.every((h) => h === '/coach#worth-a-look'),
    `rows on screen=${routeCount}`,
  );
  const chapter = page.locator('[data-testid^="home-chapter-"] > summary').first();
  await chapter.waitFor({ timeout: 30000 });
  const offset = await chapter.evaluate((s) => {
    const h = s.querySelector('h2');
    return h ? h.getBoundingClientRect().top - s.getBoundingClientRect().top : 999;
  });
  check('home: a chapter title sits on its triangle\'s line', offset < 8, `offset=${offset.toFixed(1)}px`);

  /* ── Forecast ── */
  await page.goto(`${BASE}/forecast`, { waitUntil: 'networkidle' });
  const fTitle = await page.getByRole('heading', { level: 1 }).first().boundingBox();
  check('forecast: the page title is visible', (fTitle?.height ?? 0) > 20, `h1 height=${fTitle?.height}`);
  const amounts = page.getByTestId('forecast-milestone-amount');
  const n = await amounts.count();
  const boxes = [];
  for (let i = 0; i < n; i++) boxes.push((await lineBoxesPerWord(amounts.nth(i)))[0]);
  check('forecast: every milestone balance is on one line', n > 0 && boxes.every((b) => b === 1), `lineBoxes=${JSON.stringify(boxes)}`);

  /* ── Recurring ── */
  await page.goto(`${BASE}/recurring`, { waitUntil: 'networkidle' });
  const rTitle = await page.getByRole('heading', { level: 1 }).first().boundingBox();
  check('recurring: the page title is visible', (rTitle?.height ?? 0) > 20, `h1 height=${rTitle?.height}`);

  /* ── Activity ── */
  await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });
  const toggle = page.getByTestId('txn-filters-toggle');
  await toggle.waitFor({ timeout: 30000 });
  check('activity: the Filters toggle is closed on an unfiltered register',
    (await toggle.getAttribute('aria-expanded')) === 'false');
  check('activity: the type select is folded away', !(await page.getByTestId('txn-filter-type').isVisible()));
  const firstRow = await page.getByTestId('txn-row').first().boundingBox();
  const nav = await page.getByTestId('bottom-nav').boundingBox();
  check('activity: the first transaction clears the bottom nav',
    !!firstRow && !!nav && firstRow.y + 44 < nav.y, `row.y=${firstRow?.y} nav.y=${nav?.y}`);
  // Open by state, retrying across hydration (the e2e helper's rule).
  for (let i = 0; i < 10 && (await toggle.getAttribute('aria-expanded')) !== 'true'; i++) {
    await toggle.click();
    await page.waitForTimeout(500);
  }
  check('activity: the toggle opens the folded selects', await page.getByTestId('txn-filter-type').isVisible());
  const name = page.getByTestId('txn-row').getByText('Sapphire Card', { exact: true }).first();
  check('activity: "Sapphire Card" is not broken inside a word',
    JSON.stringify(await lineBoxesPerWord(name)) === '[1,1]');
  await page.goto(`${BASE}/transactions?spendClass=fixed`, { waitUntil: 'networkidle' });
  check('activity: a filtered arrival opens the bar by itself',
    (await page.getByTestId('txn-filters-toggle').getAttribute('aria-expanded')) === 'true'
      && (await page.getByTestId('txn-filter-spend-class').isVisible()));

  /* ── Coach ── */
  await page.goto(`${BASE}/coach`, { waitUntil: 'networkidle' });
  const rest = page.getByTestId('next-dollar-more');
  await rest.waitFor({ timeout: 30000 });
  check('coach: a closed rest carries a chevron',
    await rest.locator(':scope > summary').getByTestId('disclosure-chevron').isVisible());

  /* ── Guilt-free ── */
  await page.goto(`${BASE}/spending-plan`, { waitUntil: 'networkidle' });
  const cantSee = page.getByTestId('spending-plan-disclosures');
  await cantSee.waitFor({ timeout: 30000 });
  // The tag name is the discriminator: before U.1a this testid sat on a <section>, whose
  // `open` attribute is null too.
  const limits = await cantSee.evaluate((el) => ({ tag: el.tagName, open: el.hasAttribute('open') }));
  check('guilt-free: the limits are a disclosure, closed by default',
    limits.tag === 'DETAILS' && !limits.open, JSON.stringify(limits));
  const summary = (await page.getByTestId('plan-cant-see-summary').textContent()) ?? '';
  check('guilt-free: the closed line still carries the consequence',
    /may be (lower|higher) than shown/.test(summary) && (await page.getByTestId('plan-cant-see-summary').isVisible()));
  check('guilt-free: the per-line bases stay on screen (guard — also true before U.1a)',
    await page.getByText(/Card statement payments are not subtracted here/i).isVisible());

  /* ── Settings ── */
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  const links = page.getByTestId('settings-index-link');
  await links.first().waitFor({ timeout: 30000 });
  const targets = await links.evaluateAll((as) =>
    as.map((a) => {
      const href = a.getAttribute('href') ?? '';
      return { href, found: href.startsWith('#') && document.querySelectorAll(href).length === 1 };
    }),
  );
  check('settings: the index lists the page\'s sections', targets.length >= 14, `links=${targets.length}`);
  check('settings: every index link has exactly one target',
    targets.every((t) => t.found), JSON.stringify(targets.filter((t) => !t.found)));

  /* ── Inbox ── */
  await page.goto(`${BASE}/triage`, { waitUntil: 'networkidle' });
  // The queue is a card to file OR "Inbox zero" (visitors can file the shared demo's queue
  // down to nothing) — either way it is the queue, and it must sit above the scorecard.
  const queue = page.locator('[data-testid="triage-card"], [data-testid="triage-empty"]').first();
  await queue.waitFor({ timeout: 30000 });
  const queueBox = await queue.boundingBox();
  const accuracy = await page.getByTestId('accuracy-card').boundingBox();
  check('inbox: the queue comes before the scorecard',
    !!queueBox && !!accuracy && queueBox.y < accuracy.y, `queue.y=${queueBox?.y} accuracy.y=${accuracy?.y}`);

  check('no page errors anywhere in the flow', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  check('script completed', false, String(e).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `DEPLOY PROOF: PASS, ${results.length} checks` : `DEPLOY PROOF: FAIL (${failed} failed)`);
process.exitCode = failed === 0 ? 0 : 1;
