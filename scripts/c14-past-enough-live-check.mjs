/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the C14 "past enough" Coast-FI framing, run against PRODUCTION.
 *
 * /coach is auth-gated, so `curl | grep` gets a 307 and proves nothing
 * (`committed-is-not-shipped`). This signs into the shared demo — one click,
 * no credentials — and reads the real page. Read-only throughout: it never
 * submits a form or writes anything.
 *
 * ANTI-VACUITY. The demo is NOT Coast FI (its Coast line names the monthly
 * pace it would take), so `past-enough-coast` is correctly ABSENT on the demo
 * page — absence alone proves nothing (the pre-#503 build is absent too). The
 * sha is therefore proved by BUNDLE CONTENT: the new sentence ships in the
 * coach page's client bundles even when the gate keeps it off the demo screen,
 * and a pre-#503 deploy has no such string anywhere. The script fetches every
 * script the live page actually loaded and greps them for the marker.
 *
 *   node scripts/c14-past-enough-live-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MARKER = 'turn the dial toward experiences and giving';
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
  const coast = page.getByTestId('coast-fi');
  await coast.waitFor({ state: 'visible', timeout: 30_000 });

  // #502 content still renders (the deploy carries the prior slices too).
  await page.getByTestId('life-energy-list').waitFor({ state: 'visible', timeout: 30_000 });
  const reflection = page.getByTestId('life-energy-reflection');
  check('#502 memory-dividend reflection still renders on demo', (await reflection.count()) === 1);

  // Demo is NOT Coast FI → the gate keeps the new line off the demo screen.
  const coastText = ((await coast.textContent()) ?? '');
  check('demo coast line names the required monthly pace (not-coast branch)', coastText.includes('it takes about'), coastText.slice(0, 80));
  check(
    'past-enough line stays off a not-Coast-FI screen',
    (await page.getByTestId('past-enough-coast').count()) === 0,
  );

  // The sha, proved by content: the new sentence must be in the bundles this
  // page loaded. A stale deploy has the string nowhere. The marker is passed in
  // so the browser-context fetch can't drift from the constant above.
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
  check('C14 sentence is in the live /coach client bundles', loaded.length > 0, `${loaded.length} chunk(s)`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
