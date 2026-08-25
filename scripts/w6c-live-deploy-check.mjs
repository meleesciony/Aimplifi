/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for W.6(c) category fulfillment curve (DECISIONS #513), run against PRODUCTION.
 *
 * /coach is auth-gated. Signs into the shared demo and checks the life-energy-
 * by-category card: truncated subtitle (not "each"), spark with month labels,
 * omitted disclosure, median-trend footnote.
 *
 * ANTI-VACUITY. A pre-#513 deploy has no `fulfillment-card` testid.
 *
 *   node scripts/w6c-live-deploy-check.mjs
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

async function signInDemo() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('demo-sign-in').click();
    try {
      await page.waitForURL('**/dashboard', { timeout: 10_000 });
      return;
    } catch {
      // Native/aborted submit — reload and click again once hydrated.
    }
  }
  throw new Error('demo sign-in never reached /dashboard in 3 attempts');
}

try {
  await signInDemo();
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  const card = page.getByTestId('fulfillment-card');
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  check('coach has fulfillment-card', true);

  const subtitle = ((await page.getByTestId('fulfillment-subtitle').textContent()) ?? '').trim();
  check('subtitle names complete months', /complete months/i.test(subtitle), subtitle.slice(0, 120));
  check('subtitle does not claim each category when truncated', !/\beach discretionary\b/i.test(subtitle), subtitle.slice(0, 120));
  check('subtitle names the top-N ranking', /took the most working hours/i.test(subtitle), subtitle.slice(0, 120));

  await expectVisible(page.getByTestId('fulfillment-list'));
  check('fulfillment list has rows', true);

  const spark = ((await page.getByTestId('fulfillment-spark').first().textContent()) ?? '').trim();
  check('spark has month labels', /Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov/i.test(spark), spark.slice(0, 80));
  check('spark ends with hrs unit', /hrs\s*$/i.test(spark), spark.slice(-20));

  const omitted = ((await page.getByTestId('fulfillment-omitted').textContent()) ?? '').trim();
  check('omitted line discloses more categories', /more discretionary/i.test(omitted), omitted.slice(0, 100));

  const footnote = ((await page.getByTestId('fulfillment-footnote').textContent()) ?? '').trim();
  check('footnote names $38/hr wage', footnote.includes('$38.00/hr'), footnote.slice(0, 100));
  check('footnote names typical median basis', footnote.includes('typical (median)'), footnote.slice(0, 100));
  check('footnote names fulfillment curve', footnote.includes('fulfillment curve'));
  check('card has no this-card/below', !/this card|\bbelow\b/i.test(((await card.textContent()) ?? '')));
} finally {
  await browser.close();
}

async function expectVisible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
