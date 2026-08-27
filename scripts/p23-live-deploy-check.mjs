/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the C2 dashboard cushion line (DECISIONS #523): on /dashboard,
 * the Cash Flow Radar card's projected dip is paired with the reader's runway
 * cushion ("surprises are what history guarantees … your N-month cushion is what
 * handles what no forecast sees").
 *
 * /dashboard is auth-gated, so `curl | grep` gets a 307 and proves nothing
 * (`committed-is-not-shipped`). This signs into the shared demo — one click,
 * no credentials — and reads the real page. Read-only throughout: it never
 * submits a form or writes anything.
 *
 * FRESH-DEPLOY PROOF. The pre-#523 build has no `radar-cushion-line` element
 * at all, so a stale deploy cannot pass this file. The sha is proved by
 * content, not by a deployment listing.
 *
 *   node scripts/p23-live-deploy-check.mjs
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

  const card = page.getByTestId('cash-flow-radar-card');
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  const status = (await page.getByTestId('radar-status').textContent()) ?? '';
  check('radar card renders on /dashboard', true, `status: ${status}`);

  const line = page.getByTestId('radar-cushion-line');
  await line.waitFor({ state: 'visible', timeout: 10_000 });
  const text = ((await line.textContent()) ?? '').trim();
  check('cushion line renders beside the projected dip', true, text);
  check('sentence names surprises as history', /history guarantees/i.test(text));
  check('sentence carries the cushion', /cushion is what handles what no forecast sees/i.test(text));
  check('no shame language', !/\b(wasted|stop buying|guilty|shame|irresponsible)\b/i.test(text));
  // The cover transfer above handles the KNOWN dip; this line must not steal it.
  check('claims no cover of the shown dip', !/\b(this dip|handles it|will cover)\b/i.test(text));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
