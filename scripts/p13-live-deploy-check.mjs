/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for P1.3 "My Rich Life" (DECISIONS #504), run against PRODUCTION.
 *
 * /coach and /settings are auth-gated, so `curl | grep` gets a 307 and proves
 * nothing (`committed-is-not-shipped`). This signs into the shared demo — one
 * click, no credentials — and reads the real pages. Read-only throughout: it
 * never submits a form or writes anything.
 *
 * ANTI-VACUITY. The demo can never HOLD a vision (write + read legs are fenced),
 * so the echo is correctly ABSENT on the demo — absence alone proves nothing.
 * The sha is therefore proved by BUNDLE CONTENT: the scoped P1.3 sentence ships
 * in the coach page's client bundles, and a pre-#504 deploy has no such string
 * anywhere. The script fetches every script the live coach page actually loaded
 * and greps them for the marker.
 *
 *   node scripts/p13-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MARKER = 'Every number about your money below';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

/**
 * The demo button is type="submit": a click that lands before hydration fires a
 * NATIVE submit and lands on /sign-in (seen twice, 2026-08-23 — the C14 and
 * P1.3 checks). The hydrated click is the one that signs in, so retry through
 * '/' once: the second attempt always executes the React handler.
 */
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

  // The settings card renders for the demo — WITH the shared-account note and
  // NO input (the fence is visible, not just server-side).
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('rich-life-card').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('rich-life-demo-note').waitFor({ state: 'visible', timeout: 30_000 });
  check('demo settings shows the My Rich Life card and its shared-account note', true);
  check(
    'demo sees no rich-life input (write leg is fenced in the UI too)',
    (await page.getByTestId('rich-life-input').count()) === 0,
  );

  // The demo's /coach renders no echo (the demo row can never hold a vision).
  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('coast-fi').waitFor({ state: 'visible', timeout: 30_000 });
  check('demo /coach shows no Rich Life echo', (await page.getByTestId('rich-life-vision').count()) === 0);

  // The sha, proved by content: the scoped P1.3 sentence must be in the bundles
  // this page loaded. A pre-#504 deploy has the string nowhere.
  const loaded = await page.evaluate(async (marker) => {
    const hrefs = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => u.includes('/_next/') && /\.[jt]s/.test(u));
    const found = [];
    for (const u of hrefs) {
      try {
        const t = await fetch(u).then((r) => r.text());
        if (t.includes(marker)) found.push(u);
      } catch {
        /* a chunk that can't be read is not the proof; skip */
      }
    }
    return found;
  }, MARKER);
  check('P1.3 scoped sentence is in the live /coach client bundles', loaded.length > 0, `${loaded.length} chunk(s)`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
