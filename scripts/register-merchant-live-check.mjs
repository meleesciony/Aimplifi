/**
 * Deploy proof for the merchant-filter fix (owner report 2026-08-07), run
 * against PRODUCTION. Read-only: it signs in as the shared DEMO user, never the
 * owner, and writes nothing.
 *
 * Unlike most live checks in this folder, the reported state is fully
 * reproducible as the demo user — `?merchant=<a name nobody has>` puts any
 * account into exactly the shape of the owner's screenshot — so this proves the
 * BEHAVIOUR live, not just that the new strings are in the bundle.
 *
 * The six claims, and nothing beyond them:
 *   1. the filter is VISIBLE — a chip naming the merchant being matched;
 *   2. the zero NAMES ITSELF — "No transactions here match “…”";
 *   3. the old sentence is GONE from this state ("No transactions match these
 *      filters" was the whole defect: it blamed controls the reader can see are
 *      all set to All);
 *   4. there is a way OUT that is a link, not an instruction;
 *   5. the chip CLEARS in one tap and the register comes back with rows —
 *      i.e. the data was there the entire time;
 *   6. the negative direction: an UNFILTERED register grows no chip and no
 *      Clear link, so the control is a disclosure rather than furniture.
 *
 *   node scripts/register-merchant-live-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
/** A name no row can carry — the empty-merchant state, on demand. */
const ABSENT = 'ZZZ_LIVE_CHECK_NO_SUCH_MERCHANT';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  // ── the owner's state, reproduced live ────────────────────────────────────
  await page.goto(`${BASE}/transactions?merchant=${encodeURIComponent(ABSENT)}`, {
    waitUntil: 'networkidle',
  });

  const chip = page.getByTestId('txn-filter-merchant');
  const chipCount = await chip.count();
  const chipText = chipCount ? ((await chip.textContent()) ?? '') : '';
  check('1. the merchant filter is visible', chipCount === 1 && chipText.includes(ABSENT), JSON.stringify(chipText));

  const empty = page.getByTestId('txn-empty');
  const emptyText = (await empty.textContent()) ?? '';
  check('2. the zero names the merchant it could not match', emptyText.includes(ABSENT), JSON.stringify(emptyText.slice(0, 120)));
  check('3. the old "match these filters" sentence is gone from this state', !emptyText.includes('No transactions match these filters'));

  const out = page.getByTestId('txn-empty-merchant').getByRole('link', { name: 'Show all transactions' });
  const href = (await out.count()) ? await out.getAttribute('href') : null;
  check('4. the way out is a link', href === '/transactions', String(href));

  // ── and the data was there the whole time ─────────────────────────────────
  await chip.click();
  await page.waitForURL((u) => u.pathname === '/transactions' && u.search === '', { timeout: 30000 });
  await page.getByTestId('txn-row').first().waitFor({ timeout: 30000 });
  const rows = await page.getByTestId('txn-row').count();
  check('5. one tap clears it and the rows come back', rows > 0, `${rows} rows`);

  // ── negative direction ───────────────────────────────────────────────────
  check('6a. an unfiltered register grows no merchant chip', (await page.getByTestId('txn-filter-merchant').count()) === 0);
  check('6b. an unfiltered register shows no Clear link', (await page.getByTestId('txn-clear').count()) === 0);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed on ${BASE}`);
process.exit(failed.length === 0 ? 0 : 1);
