/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the P0.4 assign-to-zero line (DECISIONS #525): on /budgets,
 * the conscious-spending strip highlights leftover `leftToSpendCents` as
 * unassigned ("still unassigned" / "guilt-free remainder" / "not a verdict").
 *
 * /budgets is auth-gated, so `curl | grep` gets a 307 and proves nothing
 * (`committed-is-not-shipped`). This signs into the shared demo — one click,
 * no credentials — and reads the real page. Read-only throughout: it never
 * submits a form or writes anything.
 *
 * FRESH-DEPLOY PROOF. The pre-#525 build has no `conscious-assign-to-zero`
 * element at all, so a stale deploy cannot pass this file. The sha is proved
 * by content, not by a deployment listing. The demo leftover is positive
 * (unit-locked), so the line must render.
 *
 *   node scripts/p25-live-deploy-check.mjs
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

  await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
  const strip = page.getByTestId('conscious-buckets');
  await strip.waitFor({ state: 'visible', timeout: 30_000 });

  const line = page.getByTestId('conscious-assign-to-zero');
  await line.waitFor({ state: 'visible', timeout: 10_000 });
  const text = ((await line.textContent()) ?? '').trim();
  check('assign-to-zero line renders on the conscious-spending strip', true, text);
  check('names leftover after Fixed and savings', /leftover after Fixed and savings/i.test(text));
  check('binds the same dollars as the guilt-free remainder', /guilt-free remainder/i.test(text));
  check('names monthly capacity, not remaining cash', /monthly capacity/i.test(text) && /not cash still sitting unspent/i.test(text));
  check('is a plan not a verdict', /not a verdict/i.test(text));
  check('does not claim remaining cash', !/you have\b/i.test(text) && !/still unassigned/i.test(text));
  check('carries one dollar amount', (text.match(/\$[\d,]+\.\d{2}/g) ?? []).length === 1);
  check('no shame language', !/\b(wasted|stop buying|guilty|shame|irresponsible)\b/i.test(text));
  check('no zero-out-fun-money imperative', !/\b(should|must|zero out)\b/i.test(text));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
