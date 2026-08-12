/**
 * Deploy proof for U.4 (DECISIONS #450), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, because the honest scope is
 * narrower than "U.4 works":
 *
 *   CAN: every rendered CLAIM the slice changed. Each check below is written to
 *   FAIL on the old build — it asserts the new sentence AND the absence of the
 *   one it replaced, so a stale deployment answering 200 cannot pass it (the
 *   documented wrong-instrument class: `/current portfolio|live balance/` once
 *   matched both builds and could tell them apart).
 *
 *   CANNOT: the writer itself. The shared demo user is fenced out of it by
 *   construction — its snapshots are seeded and must stay exactly as seeded — and
 *   the one real production user's rows appear on his NEXT nightly cron sweep
 *   (`0 11 * * *`) or next sync, whichever comes first. That is the event to
 *   verify against, not this script. The writer's own contract is locked against
 *   real Prisma in tests/unit/balance-history-server.test.ts and its wiring in
 *   tests/unit/cron-sync-snapshot.test.ts.
 *
 * Also NOT demonstrable on the demo, and recorded as a SKIP rather than silently
 * omitted: the carried-forward marker on an account whose feed went quiet (no
 * seeded demo account carries `feedDroppedAt`), and the exported PDF heading.
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/u4-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const mobile = { ...devices['Pixel 5'], viewport: { width: 380, height: 800 } };

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const skip = (name, why) => console.log(`SKIP  ${name} — ${why}`);

const NEW_BASIS =
  'Each point is the balances the app had recorded on that date — an account it had no balance for then is not in it.';
const OLD_BASIS = 'Trend uses month-end balances across all accounts';

const browser = await chromium.launch();
const page = await browser.newPage(mobile);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  /* ── /dashboard: the trend's basis sentence replaced ── */
  const basis = page.getByTestId('net-worth-trend-basis');
  await basis.waitFor({ timeout: 30000 });
  const basisText = (await basis.textContent()) ?? '';
  check('dashboard: trend basis states the admission rule', basisText.includes(NEW_BASIS));
  check('dashboard: trend basis says today’s point is live', basisText.includes('Today’s point is your live balances'));
  const dashMain = (await page.locator('main').textContent()) ?? '';
  check('dashboard: the old "month-end balances across all accounts" claim is GONE', !dashMain.includes(OLD_BASIS));

  /* ── the delta: the demo's previous point IS a month-end immediately before
       this month, so its wording must be BYTE-IDENTICAL to the old build. This
       is the half that proves the change was surgical, not a rewrite. ── */
  const delta = page.getByTestId('net-worth-delta');
  const deltaText = ((await delta.textContent()) ?? '').trim();
  check(
    'dashboard: the demo delta still reads "vs last month-end" (unchanged by design)',
    deltaText.includes('vs last month-end'),
    deltaText,
  );
  check('dashboard: the delta is a figure, not a refusal (demo buckets are complete)', !deltaText.includes('No comparison'));

  /* ── the drilldown's per-point basis, reworded off the completeness claim ── */
  const chips = page.getByTestId('net-worth-points').locator('[data-testid^="net-worth-point-"]');
  await chips.first().waitFor({ timeout: 30000 });
  // The constituents panel is its own element keyed by the point's date — NOT a
  // child of the chip strip, so reading the strip's text would make both of the
  // assertions below vacuous (the negative one silently so).
  const panelOf = async (chip) => {
    const id = (await chip.getAttribute('data-testid')) ?? '';
    return page.getByTestId(`net-worth-constituents-panel-${id.replace('net-worth-point-', '')}`);
  };
  await chips.first().click();
  const firstPanel = await panelOf(chips.first());
  await firstPanel.waitFor({ timeout: 30000 });
  const panelText = (await firstPanel.textContent()) ?? '';
  check(
    'drilldown: a recorded point says "the balances the app had recorded on"',
    panelText.includes('is the sum of the month-end balances the app had recorded on'),
  );
  check(
    'drilldown: it no longer claims "every account\'s" balance',
    !panelText.includes("sum of every account's"),
  );

  /* ── the live point's contrast noun ── */
  await chips.last().click();
  const livePanel = await panelOf(chips.last());
  await livePanel.waitFor({ timeout: 30000 });
  const liveText = (await livePanel.textContent()) ?? '';
  check('drilldown: the live point contrasts with a balance recorded earlier', liveText.includes('not a balance recorded earlier'));
  check('drilldown: the old "not a month-end snapshot" contrast is GONE', !liveText.includes('not a month-end snapshot'));

  /* ── /accounts: the same chart, which previously carried NO basis sentence ── */
  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  const acctBasis = page.getByTestId('accounts-net-worth-trend-basis');
  await acctBasis.waitFor({ timeout: 30000 });
  check(
    'accounts: the second surface now carries the SAME basis sentence (it had none)',
    ((await acctBasis.textContent()) ?? '').includes(NEW_BASIS),
  );

  skip('carried-forward marker on a quiet feed', 'no seeded demo account carries feedDroppedAt');
  skip('exported PDF heading "Trend (recorded balances)"', 'requires downloading the PDF export');

  check('no page errors on any surface visited', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks PASS against ${BASE}`);
if (failed.length > 0) {
  console.error('FAILED:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
