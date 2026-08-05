/**
 * Deploy proof for C.12 (#408), run against PRODUCTION.
 *
 * The pages are auth-gated, so `curl | grep` gets a 307 and proves nothing.
 * This signs into the shared demo (one click, no credentials) and reads the
 * real page. Read-only throughout.
 *
 * FRESHNESS: the markers are all dataset-independent — the demo's shortfall
 * may be single-event (old and new titles identical), so the proof rides on
 * things ONLY the C.12 build can produce: the `forecast-scope-note` testid
 * and its DOM order above the hero figure (the old build printed the same
 * sentence as the LAST element on the page, with no testid), and client-bundle
 * literals only this build ships (the two-step split line and the radar's
 * undatable-card note live in client components).
 *
 *   node scripts/c12-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MARKERS = ['covers the first short day', 'in any figure on this card'];
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

  await page.goto(`${BASE}/forecast`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('forecast-projected').waitFor({ timeout: 30_000 });

  const note = page.getByTestId('forecast-scope-note');
  const noteVisible = await note.isVisible().catch(() => false);
  check('forecast renders the C.12 scope note (testid exists only in this build)', noteVisible);
  const noteText = (await note.textContent().catch(() => '')) ?? '';
  check(
    'scope note discloses the card-payment omission',
    noteText.includes('include card payments'),
    noteText.slice(0, 90),
  );
  const noteBeforeFigure = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="forecast-scope-note"]');
    const f = document.querySelector('[data-testid="forecast-projected"]');
    return (
      n !== null &&
      f !== null &&
      (n.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  });
  check('scope note lands BEFORE the first figure it qualifies (placement rule)', noteBeforeFigure);

  // FRESHNESS: every loaded script is fetched and searched for literals only
  // the C.12 bundle ships. A deployment still serving old chunks cannot
  // produce them.
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].map((s) => s.src),
  );
  let blobs = '';
  for (const src of scripts) {
    try {
      blobs += `${await (await page.context().request.get(src)).text()}\n`;
    } catch {
      /* a chunk that 404s cannot hold the marker */
    }
  }
  for (const marker of MARKERS) {
    check(`served client bundle carries "${marker}"`, blobs.includes(marker));
  }
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 160));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
