/**
 * Deploy proof for C.10 (#406), run against PRODUCTION.
 *
 * The wealth-target card is auth-gated, so `curl | grep` gets a 307 and proves nothing.
 * This signs into the shared demo (one click, no credentials) and reads the real page.
 * Read-only throughout — it never submits a form or writes anything.
 *
 * FRESHNESS, because the demo-visible copy is byte-identical across the change: the demo
 * seed carries no savingsTargetBps, so /coach renders the recent-surplus pace line, which
 * this slice deliberately did not change. A status code or that sentence alone would pass
 * on the OLD deployment too. The marker that separates the builds is the PLANNED-pace
 * refusal/pacing copy, which exists only in the new client bundle: after /coach loads,
 * every loaded script is fetched and searched for a literal only commit a243e90 ships.
 * A deployment still serving old chunks cannot produce it.
 *
 *   node scripts/c10-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
// String literals that exist ONLY in the C.10 build (coach-copy.ts, commit a243e90).
const MARKERS = [
  'what your plan has you setting aside',
  'nothing has been left over after spending',
];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
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
  const pace = page.getByTestId('wealth-target-pace');
  await pace.waitFor({ timeout: 30_000 });
  const paceText = (await pace.textContent()) ?? '';
  // The demo is recent-surplus: the pace line must state an arrival — proof the NEW
  // selector's routing renders live (a crash or a null line fails here).
  check(
    'wealth-target pace line renders an arrival (selector routing live)',
    /you'd get there in about \d+ year/.test(paceText),
    paceText.slice(0, 80),
  );

  // Freshness: the served client bundle must carry the C.10-only literals.
  const scriptUrls = await page.$$eval('script[src]', (els) => els.map((e) => e.src));
  let found = [];
  for (const url of scriptUrls) {
    try {
      const text = await page.evaluate(async (u) => (await fetch(u)).text(), url);
      found = found.concat(MARKERS.filter((m) => text.includes(m)));
    } catch {
      // A chunk that 404s mid-check is not the marker's absence; the next one may carry it.
    }
  }
  const fresh = MARKERS.every((m) => found.includes(m));
  check(
    'served bundle carries the C.10 copy (freshness marker)',
    fresh,
    fresh ? 'both C.10 literals found in loaded scripts' : `found only: ${found.join(', ') || 'none'} of ${MARKERS.length}`,
  );
} catch (err) {
  check('live deploy check completed', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? '\nDEPLOY PROOF: PASS' : `\nDEPLOY PROOF: FAIL (${failed.length})`);
process.exit(failed.length === 0 ? 0 : 1);
