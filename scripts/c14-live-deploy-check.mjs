/**
 * Deploy proof for C.14 (#432), run against PRODUCTION.
 *
 * The two fixes are (1) a text change on /goals — the third FI state named by
 * the coach instead of the literal "null months" — and (2) a math change in
 * the FI simulation. The math is proven by the unit locks and the gate; live,
 * what discriminates THIS build from the last is the goals card still
 * rendering its impact sentences (the old build rendered them too, but a
 * regression in either state would surface here), no literal "null" anywhere,
 * and no page errors. The demo has no beyond-surplus goal, so the null state
 * itself is structurally unreachable live — that text is proven by the
 * copy-locked unit sweep, as the C.23 check documented for its own fence.
 *
 * Read-only: one-click demo sign-in, one page read, writes nothing.
 *
 *   node scripts/c14-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  await page.goto(`${BASE}/goals`, { waitUntil: 'networkidle' });
  const body = await page.locator('body').innerText();

  check(
    'worked example states its FI effect (the changed composition)',
    /would move your FI date back|wouldn't move your FI date/.test(body),
  );
  check('no literal "null" in the page text', !/\bnull\b/i.test(body));
  check(
    'the impact renders its numbers (~49 months funding, ~13 delay)',
    /funded in ~49 months/.test(body) && /FI date back ~13 months/.test(body),
  );
  check('no page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 200));
} catch (err) {
  check('flow completes', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed === 0 ? 0 : 1);
