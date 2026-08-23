/**
 * Deploy proof for P2.2 (DECISIONS #502), run against PRODUCTION.
 *
 * /coach is auth-gated, so `curl | grep` gets a 307 and proves nothing
 * (`committed-is-not-shipped`). This signs into the shared demo — one click,
 * no credentials — and reads the real page. Read-only throughout: it never
 * submits a form or writes anything.
 *
 * ANTI-VACUITY. The demo's biggest purchases include rent, which is not a
 * travel/dining money dial, so the P2.2 build MUST print the memory-dividend
 * reflection on /coach. The pre-#502 build has no `life-energy-reflection`
 * element at all, so a stale deploy cannot pass this file. The sha is proved
 * by content, not by a deployment listing.
 *
 *   node scripts/p22-live-deploy-check.mjs
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

  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('life-energy-list').waitFor({ state: 'visible', timeout: 30_000 });
  check('life-energy list renders at all', true, '/coach');

  const reflection = page.getByTestId('life-energy-reflection');
  const count = await reflection.count();
  check('memory-dividend reflection renders (rent is not a dial)', count === 1, `${count} found`);
  const text = count === 1 ? ((await reflection.first().textContent()) ?? '') : '';
  check(
    'reflection is the P2.2 sentence',
    text.includes("memory you'll keep") && text.includes('almost no one notices'),
    text.slice(0, 120),
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
