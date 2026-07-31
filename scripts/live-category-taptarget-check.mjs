/**
 * Deploy proof for the 2026-07-31 tap-target fix, run against PRODUCTION.
 *
 * The pages are auth-gated, so `curl | grep` cannot reach the markers — it gets
 * a 307. This signs into the shared demo (one click, no credentials) and drives
 * the real site, which is the only thing that proves the change is live.
 *
 * It asserts the PROPERTY, not just the presence of a testid: the name link and
 * the figure link on the same row must resolve to the same href, and following
 * the NAME must land on the filtered register. Read-only throughout — it never
 * submits a form or writes anything.
 *
 *   node scripts/live-category-taptarget-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  // ---- /budgets: the category NAME is a link ----
  await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
  const rowCount = await page.locator('[data-testid^="budget-row-"]').count();
  // Anti-vacuity: the absence checks below are worthless on an empty page.
  check('/budgets renders category rows at all', rowCount > 0, `${rowCount} rows`);

  const nameLink = page.locator('[data-testid^="budget-category-name-link-"]').first();
  const nameLinkCount = await page.locator('[data-testid^="budget-category-name-link-"]').count();
  check('the category NAME is a link (the reported defect)', nameLinkCount > 0, `${nameLinkCount} name links`);

  if (nameLinkCount > 0) {
    const categoryId = (await nameLink.getAttribute('data-testid')).replace(
      'budget-category-name-link-',
      '',
    );
    const nameHref = await nameLink.getAttribute('href');
    const figureHref = await page
      .getByTestId(`budget-category-link-${categoryId}`)
      .getAttribute('href');
    check('name and figure on one row go to the SAME place', nameHref === figureHref, nameHref);

    const box = await nameLink.boundingBox();
    check('the name is a real tap target', box.width > 60, `${Math.round(box.width)}px wide`);

    await nameLink.click();
    await page.waitForURL('**/transactions?category=**', { timeout: 30_000 });
    const url = new URL(page.url());
    check(
      'following the NAME lands on the filtered register, window intact',
      url.searchParams.get('category') === categoryId && /^\d{4}-\d{2}-01$/.test(url.searchParams.get('from')),
      page.url().replace(BASE, ''),
    );
    // The date controls the owner asked about ("and I can define date").
    // WAIT for them rather than counting immediately: the first draft of this
    // probe counted straight after waitForURL, found 0, and would have reported
    // a false defect about a control that is present and works.
    const fromInput = page.getByLabel('From date');
    const dateOk = await fromInput
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    const dateCount = await page.locator('input[type="date"]').count();
    check(
      'the register exposes date inputs the reader can change',
      dateOk && dateCount >= 2,
      `${dateCount} date inputs; From prefilled "${await fromInput.inputValue().catch(() => '?')}"`,
    );
  }

  // ---- /reports: the BAR is inside the row anchor ----
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('category-breakdown').waitFor({ timeout: 30_000 });
  const row = page.locator('[data-testid^="category-link-"]').first();
  const expectedHref = await row.getAttribute('href');
  const bar = row.locator('span.rounded-full').first();
  const barVisible = await bar.isVisible().catch(() => false);
  check('the /reports bar now lives inside its row link', barVisible, expectedHref ?? '');

  if (barVisible) {
    const b = await bar.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForURL('**/transactions?category=**', { timeout: 30_000 });
    const u = new URL(page.url());
    check('tapping the BAR opens that category', `${u.pathname}?${u.searchParams}` === expectedHref, page.url().replace(BASE, ''));
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed on ${BASE}`);
process.exit(failed.length === 0 ? 0 : 1);
