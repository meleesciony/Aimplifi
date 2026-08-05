/**
 * Deploy proof for C.26 / audit P1-28 (#410), run against PRODUCTION.
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST, stated up front:
 *
 *  1. THE LINK'S `to=` DATE. Before C.26 every /reports category link was
 *     windowed on `monthWindow(month)` — the last day of the month. Now it is
 *     built by `getReports` from the same `SpendWindow` the figure was summed
 *     with, so for the CURRENT month it stops at today. On the shared demo,
 *     whose "today" is mid-month, the old build and this one therefore emit
 *     different hrefs, and the old value is unreachable. This is the check that
 *     could not pass on a stale deployment.
 *  2. A CLIENT-BUNDLE LITERAL. `reports-view.tsx` is a client component, so the
 *     `reports-not-counted-yet` testid and the page-level sentence this commit
 *     added are compiled into a served chunk.
 *  3. THE INVARIANT ITSELF, executed live: the figure is followed to the
 *     register and the destination's Money-out is compared against the number
 *     that was clicked — the O.5/O.6 claim, which is exactly what the first
 *     attempt at this slice broke ($120.00 clicked, $520.00 of rows).
 *
 * WHAT IT CANNOT PROVE: the demo dataset carries no future-dated rows, so the
 * new disclosure has nothing to say and no rendered FIGURE differs between the
 * old build and this one. Claiming a visible money difference from a live
 * screenshot here would be fabricating one. The clamp is proven by the href it
 * produces and by the unit locks over a seeded future-dated row, not by a demo
 * figure that cannot move.
 *
 * Read-only throughout: one-click demo sign-in, reads two pages, writes nothing.
 *
 *   node scripts/c26-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MARKERS = ['reports-not-counted-yet', 'is dated later than today'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Cents from a rendered "$1,234.56". */
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

  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('reports-category-total').waitFor({ timeout: 30_000 });
  check('/reports renders its category table', true);

  // FRESHNESS — markers this commit introduced.
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

  // THE DISCRIMINATOR — the link's window is the figure's, so on the current
  // month it stops at today rather than at the month end.
  const link = page.locator('[data-testid^="category-link-"]').first();
  await link.waitFor({ timeout: 30_000 });
  const href = await link.getAttribute('href');
  const to = new URL(href, BASE).searchParams.get('to');
  const from = new URL(href, BASE).searchParams.get('from');
  const monthEnd = (() => {
    const [y, m] = (from ?? '').split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  })();
  check('the category link carries an explicit window', Boolean(from && to), href ?? 'none');
  check(
    'the link stops at today, not the month end (the C.26 change)',
    to !== null && to < monthEnd,
    `to=${to} vs month end ${monthEnd}`,
  );

  // THE INVARIANT — the destination sums to the figure that was clicked.
  const figureCents = centsOf(await link.textContent());
  await page.goto(new URL(href, BASE).toString(), { waitUntil: 'domcontentloaded' });
  const out = await page.getByTestId('summary-out').textContent().catch(() => null);
  const inflow = await page.getByTestId('summary-in').textContent().catch(() => null);
  const registerCents = (centsOf(out) ?? 0) - (centsOf(inflow) ?? 0);
  check(
    'the register the figure opens nets to exactly that figure',
    figureCents !== null && figureCents === registerCents,
    `figure ${figureCents} vs register ${registerCents}`,
  );
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
