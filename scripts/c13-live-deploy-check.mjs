/**
 * Deploy proof for C.13 P1-27 (#409), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated up front because the honest answer is
 * unusual for this repo:
 *
 * Both behaviours C.13 changed are INVISIBLE ON THE DEMO by construction, and
 * that was measured rather than assumed — the shared demo carries zero
 * `AccountReconciliation` rows and zero loan-payment flow exclusions, so the
 * reconciliation keep is the R8 constant-true fast path and the new disclosure
 * has nothing to say. No rendered figure differs between the old build and this
 * one on this dataset. Anyone claiming otherwise from a live screenshot would be
 * fabricating a difference.
 *
 * So the proof is built from two things that ARE discriminating:
 *
 *  1. A CLIENT-BUNDLE LITERAL. `spend-class-panel.tsx` is a client component, so
 *     the `spend-class-loan-payment-basis` testid this build added is compiled
 *     into a served chunk. A deployment still serving the old chunks cannot
 *     produce that string, whatever the demo data looks like.
 *  2. THE INVARIANT ITSELF, executed on production: the Fixed and Discretionary
 *     headings are followed to the register and their totals compared against
 *     the destination's own Money-out figure. On this dataset the old build
 *     would also pass this — it is not a discriminator — but it is the claim the
 *     slice makes, checked live rather than asserted.
 *
 * Read-only throughout: signs into the shared demo (one click, no credentials),
 * reads two pages, writes nothing.
 *
 *   node scripts/c13-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MARKERS = ['spend-class-loan-payment-basis'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Cents from a rendered "$1,234.56" (the register prints one figure per tile). */
const centsOf = (text) => {
  const m = /\$([\d,]+)\.(\d{2})/.exec(text ?? '');
  return m === null ? null : Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('spend-class-panel').waitFor({ timeout: 30_000 });
  check('/budgets renders the Fixed vs guilt-free panel', true);

  // FRESHNESS — the one marker that separates this build from the last.
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

  // THE INVARIANT, on live data: each heading's rows sum to what the register
  // shows. The panel prints per-category subtotals rather than one heading
  // total, so the total is recomposed from the rows the reader can see — which
  // is the same set the heading links to.
  for (const [side, testId] of [
    ['Fixed', 'spend-class-fixed'],
    ['Discretionary', 'spend-class-guilt-free'],
  ]) {
    const list = page.getByTestId(testId);
    const rowTexts = await list.locator('li').allTextContents();
    const panelCents = rowTexts.reduce((sum, t) => sum + (centsOf(t) ?? 0), 0);

    const href = await list.getByTestId(`${testId}-heading`).getAttribute('href');
    check(`${side} heading links to a class-filtered register`, /spendClass=/.test(href ?? ''), href ?? 'none');

    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
    const out = await page.getByTestId('summary-out').textContent().catch(() => null);
    const registerCents = centsOf(out);
    check(
      `${side}: the register the heading opens sums to the rows behind it`,
      registerCents !== null && panelCents === registerCents,
      `panel ${panelCents} vs register ${registerCents}`,
    );
    await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('spend-class-panel').waitFor({ timeout: 30_000 });
  }
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
