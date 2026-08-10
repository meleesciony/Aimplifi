/**
 * K.7 production probe — READ-ONLY. Re-executes the 2026-08-06 observation the K.7
 * row is built on, so the fix is decided against what production actually paints
 * rather than against a fresh local seed (which behaves differently — see the
 * K.7 record in docs/STATUS.md).
 *
 * For each month it reports, from the demo's own /calendar:
 *   - every event row's label + which badge it carries ("due" vs "scheduled")
 *   - whether any row is a LOAN due (the `${accountName} due` shape with the due badge)
 *   - whether any row is an auto-loan SCHEDULED series (the stale hand-authored row)
 *
 *   node scripts/audit-probes/k7-live-probe.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MONTHS = process.env.K7_MONTHS
  ? process.env.K7_MONTHS.split(',')
  : ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  console.log(`signed into the shared demo on ${BASE}`);

  for (const month of MONTHS) {
    await page.goto(`${BASE}/calendar?month=${month}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('cal-month').waitFor({ state: 'visible', timeout: 60_000 });
    const list = page.getByTestId('calendar-list');
    const rows = (await list.count())
      ? await list.locator('li').evaluateAll((els) =>
          els
            .map((el) => el.innerText.replace(/\s+/g, ' ').trim())
            .filter((t) => t.length > 0),
        )
      : [];
    const eventRows = rows.filter((t) => / due\b/.test(t) || /\bscheduled\b/.test(t));
    console.log(`\n=== ${month} ===`);
    for (const r of eventRows) console.log(`  ${r.slice(0, 120)}`);
    if (eventRows.length === 0) console.log('  (no due/scheduled event rows)');
    const loanDue = eventRows.filter((t) => /Auto Loan due/i.test(t));
    const autoScheduled = eventRows.filter((t) => /auto ?loan/i.test(t) && /scheduled/.test(t));
    console.log(`  -> loan-due rows: ${loanDue.length} | auto-loan scheduled rows: ${autoScheduled.length}`);
  }
} finally {
  await browser.close();
}
