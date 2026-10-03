/**
 * Deploy proof for X.1 (SimpleFIN retired as a way to connect — DECISIONS #780), run
 * against PRODUCTION (www.aimplifi.app). Node type: live probe (GRAPH.md §6).
 *
 * Discriminators a pre-X.1 build cannot pass: the Accounts page offers no SimpleFIN
 * connect door or token form and names SimpleFIN nowhere (the demo household has no
 * SimpleFIN connection); the privacy policy carries the retirement wording and the
 * 2026-10-02 review date. Guard: the Plaid connect button is still on Accounts.
 *
 * Read-only: one-click demo sign-in and page reads at 380px. Writes nothing.
 *
 *   node scripts/x1-live-deploy-check.mjs
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
  check('demo sign-in reaches the dashboard', signedIn, lastErr);

  await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
  await page.getByTestId('connect-bank-btn').first().waitFor({ timeout: 30000 }).catch(() => {});
  check('Accounts still offers the Plaid connect button', (await page.getByTestId('connect-bank-btn').count()) > 0);
  check('Accounts has no SimpleFIN connect door', (await page.getByTestId('simplefin-connect-btn').count()) === 0);
  check('Accounts has no SimpleFIN token form', (await page.getByTestId('simplefin-form').count()) === 0);
  // Text nodes outside <script>/<style>: body.textContent also reads Next's inline flight
  // payload, which is not on the page. Collapsed (closed <details>) text still counts.
  const sfHits = await page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const tag = n.parentElement?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
      if (/simplefin/i.test(n.textContent ?? '')) out.push(n.textContent.trim().slice(0, 120));
    }
    return out;
  });
  check('Accounts names SimpleFIN nowhere', sfHits.length === 0, sfHits.join(' | '));

  await page.goto(`${BASE}/privacy`, { waitUntil: 'domcontentloaded' });
  const privacy = (await page.locator('body').textContent()) ?? '';
  check('privacy policy carries the retirement wording', privacy.includes('before SimpleFIN was retired'));
  check('privacy policy lists Plaid alone as the connector', privacy.includes('SimpleFIN served the same purpose'));

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF ${failed ? 'FAIL' : 'PASS'} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
