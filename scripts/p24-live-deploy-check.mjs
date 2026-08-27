/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the C5 time-window line (DECISIONS #524): on /coach, the
 * life-energy card closes C5's last gap — "buy experiences while you can" as a
 * time-window framing ("Some experiences only happen inside a window of life …").
 *
 * /coach is auth-gated, so `curl | grep` gets a 307 and proves nothing
 * (`committed-is-not-shipped`). This signs into the shared demo — one click,
 * no credentials — and reads the real page. Read-only throughout: it never
 * submits a form or writes anything.
 *
 * FRESH-DEPLOY PROOF. The pre-#524 build has no `life-energy-window` element
 * at all, so a stale deploy cannot pass this file. The sha is proved by
 * content, not by a deployment listing.
 *
 *   node scripts/p24-live-deploy-check.mjs
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
  const card = page.getByTestId('life-energy-card');
  await card.waitFor({ state: 'visible', timeout: 30_000 });

  const line = page.getByTestId('life-energy-window');
  await line.waitFor({ state: 'visible', timeout: 10_000 });
  const text = ((await line.textContent()) ?? '').trim();
  check('window line renders on the life-energy card', true, text);
  check('carries the time-window framing', /inside a window of life/i.test(text));
  check('money does not extend the moment', /doesn't wait for the money/i.test(text));
  check('no numerals (no invented figures)', !/\d/.test(text));
  check('no shame language', !/\b(wasted|stop buying|guilty|shame|irresponsible)\b/i.test(text));
  // #503's Coast-gated sentence stays Coast-gated; this one is the time framing.
  check('does not restate past-enough', !/past enough|turn the dial/i.test(text));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
