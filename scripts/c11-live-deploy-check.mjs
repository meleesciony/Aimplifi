/**
 * Deploy proof for C.11 (#407), run against PRODUCTION.
 *
 * The panels are auth-gated, so `curl | grep` gets a 307 and proves nothing.
 * This signs into the shared demo (one click, no credentials) and reads the
 * real page. Read-only throughout — it opens panels, never submits anything.
 *
 * FRESHNESS: the demo seed carries no overrides, budget targets, goals, or
 * manual accounts, so the provenance clause STILL prints on the demo's
 * multi-row guilt-free panel in both builds — that sentence alone would pass
 * on the OLD deployment. The markers that separate the builds are (a) the
 * one-row Fixed/Savings panels' new sentence and their MISSING penny-match
 * (the old build printed "This row adds up to exactly … matched to the
 * penny" there), and (b) bundle literals only commit 4b5c43c ships.
 *
 *   node scripts/c11-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
// Client-bundle literals that exist ONLY in the C.11 build (glass-box.tsx /
// redact.ts — commit 4b5c43c). The zero-income sentence ("no income has been
// detected") is NOT here: trace.ts runs server-side (RSC), so the string
// ships in server chunks and is unreachable from the demo DOM (the demo has
// income). Freshness instead rides the DOM states below, which the old build
// cannot render (it printed the penny-match on one-row panels).
const MARKERS = ['This amount is the whole figure.'];
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

  await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('conscious-buckets').waitFor({ timeout: 30_000 });

  // One-row panels: the new sentence present, the old penny-match GONE.
  await page.getByTestId('conscious-fixed-toggle').click();
  const fixedNote = page.getByTestId('conscious-fixed-reconciled');
  await fixedNote.waitFor({ timeout: 15_000 });
  const fixedText = (await fixedNote.textContent()) ?? '';
  check(
    'Fixed panel (one row) prints the C.11 sentence',
    fixedText.includes('This amount is the whole figure.'),
    fixedText.slice(0, 90),
  );
  check('Fixed panel prints NO penny-match', !fixedText.includes('matched to the penny'));
  check(
    'Fixed panel prints NO completeness claim',
    !fixedText.includes('nothing else is inside it'),
  );

  // Savings panel: the provenance clause is withheld (goals/targets are
  // chosen, and the demo's unset $0 asserts nothing).
  await page.getByTestId('conscious-savings-toggle').click();
  const savingsNote = page.getByTestId('conscious-savings-reconciled');
  await savingsNote.waitFor({ timeout: 15_000 });
  const savingsText = (await savingsNote.textContent()) ?? '';
  check(
    'Savings panel withholds the provenance clause',
    !savingsText.includes('nothing is invented'),
    savingsText.slice(0, 90),
  );

  // Guilt-free (three rows): the arithmetic sentence is retained.
  await page.getByTestId('conscious-guilt-free-toggle').click();
  const gfNote = page.getByTestId('conscious-guilt-free-reconciled');
  await gfNote.waitFor({ timeout: 15_000 });
  const gfText = (await gfNote.textContent()) ?? '';
  check(
    'Guilt-free panel (three rows) keeps the arithmetic sentence',
    gfText.includes('matched to the penny'),
    gfText.slice(0, 90),
  );

  // FRESHNESS: every loaded script is fetched and searched for literals only
  // the C.11 bundle ships. A deployment still serving old chunks cannot
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
