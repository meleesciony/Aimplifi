/**
 * Deploy proof for DECISIONS #788 ("Money you put in" on /investments, read from
 * the bank side), run against PRODUCTION. Node type: live probe (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST: the card is server-rendered on
 * /investments for every signed-in reader with an account, so the marker is
 * the card itself — `deposit-history-card`, titled "Money you put in", with its
 * "How we read this" rule note — absent from every earlier build.
 *
 * WHAT IT ALSO PROVES — NOTHING ELSE MOVED. The shared demo's guilt-free figure
 * (`DEMO_GUILT_FREE`, read before the deploy) is unchanged on Home, and the
 * portfolio total on /investments is unchanged (`DEMO_PORTFOLIO`).
 *
 * WHAT IT CANNOT PROVE: production's demo rows were written once and are never
 * re-seeded, so the seed's new Brokerage transfers (#788) are not in them; the
 * card there reads the rows production holds and says what it finds. The money
 * itself is proven by the unit locks and the e2e throwaway user.
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   DEMO_GUILT_FREE='$1,309.08' DEMO_PORTFOLIO='$142,000.00' \
 *     node scripts/deposits-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const DEMO_GUILT_FREE = process.env.DEMO_GUILT_FREE;
const DEMO_PORTFOLIO = process.env.DEMO_PORTFOLIO;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  if (!DEMO_GUILT_FREE || !DEMO_PORTFOLIO) throw new Error('set DEMO_GUILT_FREE and DEMO_PORTFOLIO');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo', true, BASE);
  const home = (await page.getByTestId('dashboard-safe-to-spend-amount').textContent())?.trim();
  check(`Home: the demo's guilt-free is unchanged (${DEMO_GUILT_FREE})`, home === DEMO_GUILT_FREE, home);

  await page.goto(`${BASE}/investments`, { waitUntil: 'domcontentloaded' });
  const card = page.getByTestId('deposit-history-card');
  await card.waitFor({ timeout: 30_000 });
  check('/investments: the "Money you put in" card renders', (await card.textContent())?.includes('Money you put in') === true);
  await card.getByTestId('deposit-rule').locator('summary').click();
  const rule = (await card.getByTestId('deposit-rule').textContent()) ?? '';
  check(
    '/investments: the card states its rule (what counts, what does not)',
    rule.includes('Never seen here: retirement contributions taken out of your paycheck'),
  );
  const lead = (await card.getByTestId('deposit-lead').count()) > 0 ? (await card.getByTestId('deposit-lead').textContent())?.trim() : null;
  const empty = (await card.getByTestId('deposit-empty').count()) > 0 ? (await card.getByTestId('deposit-empty').textContent())?.trim() : null;
  check('/investments: the card says what it found', Boolean(lead || empty), lead ?? empty ?? '');
  const total = (await page.getByTestId('investments-total-value').textContent())?.trim();
  check(`/investments: the portfolio total is unchanged (${DEMO_PORTFOLIO})`, total?.includes(DEMO_PORTFOLIO) === true, total);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('/investments at 380px: no horizontal scroll', overflow <= 0, `${overflow}px`);
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
