/**
 * Deploy proof for O.20f (DECISIONS #447), run against PRODUCTION.
 *
 * O.20f gave the five O.20d controls the repo's 44px `.tap-target` floor
 * (coarse-pointer media only) or the 24px WCAG bar floor, and wired the
 * inner-Hide focus restore. Every check below MEASURES a rendered hit box or a
 * focus landing, so the OLD build fails each one:
 *
 *   /dashboard  net-worth chip      pre-O.20f ~26px tall → now ≥ 44 (`.tap-target`)
 *   /dashboard  chip → inner Hide   pre-O.20f focus fell to <body> → now returns
 *                                   to the chip (usePanelToggleFocus, P2-d)
 *   /forecast   day chip            pre-O.20f ~26px tall → now ≥ 44 (`.tap-target`)
 *   /coach      creep bar           the whole 56px column is the target (unchanged;
 *                                   locked so a regression here fails the tour)
 *   /investments retirement bar     pre-O.20f ~4.7px wide at 380px → now ≥ 24px
 *                                   (`min-w-6`) and the strip scrolls
 *                                   (`overflow-x-auto` computed)
 *   /investments allocation legend  SKIPS loudly when the production demo has no
 *                                   holdings (its honest empty state; the surface
 *                                   is covered by the CI e2e gate on the seeded
 *                                   set); when holdings exist, the legend entry
 *                                   must measure ≥ 44 (pre-O.20f: the painted
 *                                   bar, 10px tall)
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/o20f-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
// The .tap-target token is `@media (pointer: coarse)` — measure the way the
// gate does (mobile-380 / Pixel 5: isMobile + hasTouch → pointer: coarse).
const mobile = { ...devices['Pixel 5'], viewport: { width: 380, height: 800 } };

const MIN_TAP_PX = 44 - 0.5; // -0.5 absorbs sub-pixel rounding only
const MIN_BAR_PX = 24 - 0.5;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage(mobile);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  /* ── /dashboard: the net-worth chips carry the 44px floor ── */
  const nwPoints = page.getByTestId('net-worth-points');
  await nwPoints.waitFor({ timeout: 30000 });
  const nwChip = nwPoints.getByTestId(/net-worth-point-/).first();
  const chipBox = await nwChip.boundingBox();
  check(
    'dashboard: the net-worth chip hit box clears the 44px tap-target floor',
    chipBox !== null && chipBox.height >= MIN_TAP_PX,
    chipBox ? `${Math.round(chipBox.height)}px` : 'no box',
  );

  /* ── /dashboard: inner Hide returns focus to the chip (P2-d) ── */
  await nwChip.click();
  const nwPanel = page.getByTestId(/net-worth-constituents-panel-/);
  await nwPanel.waitFor({ state: 'visible', timeout: 10000 });
  const chipId = await nwChip.getAttribute('data-testid');
  const date = chipId.replace('net-worth-point-', '');
  await page.getByTestId(`net-worth-constituents-toggle-${date}`).click();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  check(
    'dashboard: hiding from inside the panel restores focus to the chip',
    focused === chipId,
    `activeElement=${focused}`,
  );

  /* ── /forecast: the day chips carry the 44px floor ── */
  await page.goto(`${BASE}/forecast`, { waitUntil: 'networkidle' });
  const flowDays = page.getByTestId('forecast-flow-days');
  await flowDays.waitFor({ timeout: 30000 });
  const dayChip = flowDays.getByTestId(/forecast-day-chip-/).first();
  const dayBox = await dayChip.boundingBox();
  check(
    'forecast: the day chip hit box clears the 44px tap-target floor',
    dayBox !== null && dayBox.height >= MIN_TAP_PX,
    dayBox ? `${Math.round(dayBox.height)}px` : 'no box',
  );

  /* ── /coach: the creep bar column is the target (56px; locked, not new) ── */
  await page.goto(`${BASE}/coach`, { waitUntil: 'networkidle' });
  const creepCard = page.getByTestId('creep-card');
  await creepCard.waitFor({ timeout: 30000 });
  const creepBar = creepCard.getByTestId(/creep-bar-/).first();
  const creepBox = await creepBar.boundingBox();
  check(
    'coach: the creep bar hit box clears the 44px tap-target floor',
    creepBox !== null && creepBox.height >= MIN_TAP_PX,
    creepBox ? `${Math.round(creepBox.height)}px` : 'no box',
  );

  /* ── /investments: the retirement bars are ≥24px wide and the strip scrolls ── */
  await page.goto(`${BASE}/investments`, { waitUntil: 'networkidle' });
  const outlook = page.getByTestId('retirement-outlook');
  await outlook.waitFor({ timeout: 30000 });
  const retirementBar = outlook.getByTestId(/retirement-bar-/).first();
  const barBox = await retirementBar.boundingBox();
  check(
    'investments: the retirement bar is at least 24px wide (WCAG 2.5.8)',
    barBox !== null && barBox.width >= MIN_BAR_PX,
    barBox ? `${Math.round(barBox.width)}px` : 'no box',
  );
  const stripScrolls = await page.evaluate(() => {
    const strip = document.querySelector('[aria-label^="Projected portfolio balance"]');
    return strip ? getComputedStyle(strip).overflowX : null;
  });
  check(
    'investments: the retirement strip scrolls horizontally (overflow-x: auto)',
    stripScrolls === 'auto',
    stripScrolls ?? 'strip not found',
  );

  /* ── /investments: the allocation legend entries are 44px buttons ──
     Data-adaptive like the O.20d check: the production demo currently has no
     holdings and renders the honest empty state — SKIP loudly then. */
  const summary = page.getByTestId('investments-summary');
  if (await summary.isVisible().catch(() => false)) {
    const segment = page.getByTestId(/allocation-segment-/).first();
    await segment.waitFor({ timeout: 10000 });
    const segBox = await segment.boundingBox();
    check(
      'investments: the allocation legend entry clears the 44px tap-target floor',
      segBox !== null && segBox.height >= MIN_TAP_PX,
      segBox ? `${Math.round(segBox.height)}px` : 'no box',
    );
  } else {
    const emptyVisible = await page.getByTestId('investments-empty').isVisible().catch(() => false);
    check(
      'investments: allocation legend (SKIPPED — production demo has no holdings)',
      emptyVisible,
      'empty state renders honestly; surface covered by CI e2e on the seeded dataset',
    );
  }

  check('zero page errors on the tour', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');
} catch (e) {
  check('tour completed without an exception', false, String(e).split('\n')[0]);
}

await browser.close();

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.name.includes('SKIPPED'));
console.log(
  `\n${failed.length === 0 ? 'DEPLOY PROOF: PASS' : `DEPLOY PROOF: FAIL (${failed.length}/${results.length})`} — ${results.length} checks against ${BASE}${skipped.length > 0 ? ` (${skipped.length} SKIPPED, each with its reason above)` : ''}`,
);
process.exit(failed.length === 0 ? 0 : 1);
