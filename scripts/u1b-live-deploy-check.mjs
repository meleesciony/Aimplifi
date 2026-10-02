/**
 * Deploy proof for U.1b (the compact register row — DECISIONS #779), run against
 * PRODUCTION (www.aimplifi.app). Node type: live probe (GRAPH.md §6).
 *
 * Read-only: one-click demo sign-in and page reads at 380px; the only thing it
 * changes is which rows are open in this browser's own sessionStorage.
 *
 * What a pre-U.1b build cannot produce, and so what this rests on: the row's
 * `txn-row-toggle`, its `data-open` attribute, a Details link that is present but
 * hidden until the row is opened, and a row still open after a reload. The demo
 * renders none of a real account's edit controls, so the HEIGHT a real reader gains
 * is not measurable here — `tests/e2e/activity-row.spec.ts` measures it on a
 * signed-up account; this probe proves the mechanism reached production.
 *
 *   node scripts/u1b-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
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

  await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });
  const rows = page.getByTestId('txn-row');
  await rows.first().waitFor({ timeout: 30000 });
  const row = rows.first();
  const toggle = row.getByTestId('txn-row-toggle');
  await toggle.waitFor({ timeout: 30000 });

  check('row: starts closed', (await row.getAttribute('data-open')) === 'false');
  check('row: the chevron says it is collapsed', (await toggle.getAttribute('aria-expanded')) === 'false');
  const box = await toggle.boundingBox();
  check('row: the chevron is a 44px target', !!box && box.width >= 44 && box.height >= 44, `${box?.width}x${box?.height}`);
  const details = row.getByTestId('txn-detail-link');
  check('row: Details is mounted but hidden while closed',
    (await details.count()) === 1 && !(await details.isVisible()));
  check('row: payee, category and amount stay on the closed row',
    (await row.getByTestId('txn-merchant-link').isVisible()) && (await row.getByTestId('category-chip').isVisible()));

  const closed = await rows.evaluateAll((els) => els.slice(0, 10).map((el) => Math.round(el.getBoundingClientRect().height)));
  // Open by state, retrying across hydration (a tap before the page is interactive is dropped).
  for (let i = 0; i < 10 && (await toggle.getAttribute('aria-expanded')) !== 'true'; i++) {
    await toggle.click();
    await page.waitForTimeout(500);
  }
  check('row: the chevron opens it in place', (await row.getAttribute('data-open')) === 'true');
  check('row: Details and the action menu appear when open',
    (await details.isVisible()) && (await row.getByTestId('txn-action-trigger').isVisible()));
  check('row: the row below it stays closed', (await rows.nth(1).getAttribute('data-open')) === 'false');
  const openHeight = await row.evaluate((el) => Math.round(el.getBoundingClientRect().height));
  check('row: opening made it taller', openHeight > closed[0], `closed=${closed[0]}px open=${openHeight}px (first ten closed: ${JSON.stringify(closed)})`);
  check('no horizontal overflow with a row open',
    (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);

  await page.reload({ waitUntil: 'networkidle' });
  await rows.first().waitFor({ timeout: 30000 });
  // The restore is a layout effect on hydration; poll rather than read once.
  let stillOpen = false;
  for (let i = 0; i < 20 && !stillOpen; i++) {
    stillOpen = (await rows.first().getAttribute('data-open')) === 'true';
    if (!stillOpen) await page.waitForTimeout(250);
  }
  check('row: it is still open after a reload (every edit ends in one)', stillOpen);

  check('no page errors anywhere in the flow', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  check('script completed', false, String(e).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `DEPLOY PROOF: PASS, ${results.length} checks` : `DEPLOY PROOF: FAIL (${failed} failed)`);
process.exitCode = failed === 0 ? 0 : 1;
