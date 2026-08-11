/**
 * Deploy proof for O.20d (#441), run against PRODUCTION.
 *
 * O.20d made the last five inert bars/charts real controls. Each surface's
 * marker testid cannot exist on the previous build (they are all new in this
 * slice), so presence alone proves the new deployment; the checks go one step
 * further and assert the disclosure contract each surface promised:
 *
 *   /coach   creep strip     — a bar opens the month's discretionary rows (or
 *                              the honest empty copy), with a basis sentence
 *   /dashboard  net worth    — the point chips open the account constituents;
 *                              month-end says "assets minus liabilities"
 *   /accounts net worth      — same drillable points (second surface)
 *   /forecast balance line   — a day chip opens that day's scheduled flows and
 *                              says the balance line is cumulative
 *   /investments allocation  — a segment opens the accounts holding that symbol
 *                              (SKIPS when the demo has no holdings — the empty
 *                              state is production's honest truth; the surface
 *                              is covered by the CI e2e gate on the seeded set)
 *   /investments retirement  — the age-currentAge bar is the LIVE portfolio and
 *                              says so; age-65 is a projection and refuses
 *
 * Data-driven: whatever the demo's pinned data shows, each check asserts the
 * panel's own rows and sentences, not hardcoded figures (the demo's numbers
 * change as the seed evolves; the CONTRACT does not).
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/o20d-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  /* ── /coach: the creep strip drills the month's discretionary purchases ── */
  await page.goto(`${BASE}/coach`, { waitUntil: 'networkidle' });
  const creepCard = page.getByTestId('creep-card');
  await creepCard.waitFor({ timeout: 30000 });
  const bar = creepCard.getByTestId(/creep-bar-/).first();
  await bar.waitFor({ timeout: 30000 });
  check('coach: the creep strip has drillable bars', (await creepCard.getByTestId(/creep-bar-/).count()) >= 1);
  await bar.click();
  const creepPanel = page.getByTestId(/creep-bar-panel-/);
  await creepPanel.waitFor({ state: 'visible', timeout: 10000 });
  const creepText = await creepPanel.innerText();
  check(
    'coach: the bar opens a panel that states what the month is',
    /discretionary/i.test(creepText),
  );

  /* ── /dashboard: net-worth points open their account constituents ── */
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  const nwPoints = page.getByTestId('net-worth-points');
  await nwPoints.waitFor({ timeout: 30000 });
  const nwChip = nwPoints.getByTestId(/net-worth-point-/).first();
  await nwChip.click();
  const nwPanel = page.getByTestId(/net-worth-constituents-panel-/);
  await nwPanel.waitFor({ state: 'visible', timeout: 10000 });
  const nwText = await nwPanel.innerText();
  // A non-empty panel proves nothing — an empty-state panel is also non-empty.
  // The constituent panel's job is to list accounts WITH their balances, so the
  // discriminating assertion is a rendered money figure inside the panel.
  check(
    'dashboard: the net-worth point opens a panel listing account balances',
    /\$[\d,]+\.\d{2}/.test(nwText),
  );
  check(
    'dashboard: the panel names its basis (assets minus liabilities / live balance)',
    /assets minus liabilities|live balance/i.test(nwText),
  );

  /* ── /accounts: the second net-worth surface is equally drillable ── */
  await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
  const acctPoints = page.getByTestId('accounts-net-worth-points');
  await acctPoints.waitFor({ timeout: 30000 });
  const acctChip = acctPoints.getByTestId(/accounts-net-worth-point-/).first();
  await acctChip.click();
  const acctPanel = page.getByTestId(/accounts-net-worth-constituents-panel-/).first();
  await acctPanel.waitFor({ state: 'visible', timeout: 10000 });
  // Was `check(..., true)` — a check that asserts a literal proves nothing about
  // the live page and inflated the live-check count by one. The panel's own
  // rendered text is the evidence: its basis sentence plus a balance figure.
  const acctText = await acctPanel.innerText();
  check(
    'accounts: the net-worth point opens a panel naming its basis and balances',
    /assets minus liabilities|live balance/i.test(acctText) && /\$[\d,]+\.\d{2}/.test(acctText),
  );

  /* ── /forecast: a day chip opens the scheduled flows that move the line ── */
  await page.goto(`${BASE}/forecast`, { waitUntil: 'networkidle' });
  const flowDays = page.getByTestId('forecast-flow-days');
  await flowDays.waitFor({ timeout: 30000 });
  const dayChip = flowDays.getByTestId(/forecast-day-chip-/).first();
  await dayChip.click();
  const dayPanel = page.getByTestId(/forecast-day-panel-/);
  await dayPanel.waitFor({ state: 'visible', timeout: 10000 });
  const dayText = await dayPanel.innerText();
  check('forecast: a day chip opens that day\'s flows', /flow|income|bill|payment|salary/i.test(dayText));
  check(
    'forecast: the panel says the line is cumulative, not the rows\' sum',
    /cumulative|change|never add up/i.test(dayText),
  );

  /* ── /investments: allocation segments open per-symbol account rows ──
     Data-adaptive: the drilldown renders only when the demo user HAS holdings.
     The production demo currently has none (seeded pre-holdings; the seed's
     holdings postdate it) and the honest empty state renders instead — the
     surface is verified by the CI e2e gate on the seeded dataset, and the
     retirement bars below prove THIS build is live, so a missing drilldown is
     a data gap, not a deploy defect. SKIP loudly rather than fail or fake. */
  await page.goto(`${BASE}/investments`, { waitUntil: 'networkidle' });
  const summary = page.getByTestId('investments-summary');
  if (await summary.isVisible().catch(() => false)) {
    await page.getByTestId('investments-allocation').waitFor({ timeout: 10000 });
    const segment = page.getByTestId(/allocation-segment-/).first();
    await segment.click();
    const allocPanel = page.getByTestId(/allocation-panel-/);
    await allocPanel.waitFor({ state: 'visible', timeout: 10000 });
    const allocText = await allocPanel.innerText();
    check('investments: a segment opens the accounts holding that symbol', /account|market value/i.test(allocText));
  } else {
    const emptyVisible = await page.getByTestId('investments-empty').isVisible().catch(() => false);
    check(
      'investments: allocation drilldown (SKIPPED — production demo has no holdings)',
      emptyVisible,
      'empty state renders honestly; surface covered by CI e2e on the seeded dataset',
    );
  }

  /* ── /investments: the retirement bars refuse honestly ── */
  await page.getByTestId('retirement-outlook').waitFor({ timeout: 30000 });
  // The age-currentAge bar is the LIVE portfolio — its refusal says so.
  await page.getByTestId('retirement-bar-40').click();
  const curPanel = page.getByTestId('retirement-bar-panel-40');
  await curPanel.waitFor({ state: 'visible', timeout: 10000 });
  const curText = await curPanel.innerText();
  check(
    'retirement: the age-currentAge bar says it is the current portfolio, not a projection',
    /current portfolio|live balance/i.test(curText) && !/no transactions or holdings/.test(curText),
  );
  // O.20d-FU: the check above passes on the PRE-FU copy too ("…the live balance
  // of your investment accounts today" contains "live balance"), so it cannot
  // tell the deployed build apart. These three can: the new basis wording, the
  // F3 reconciliation sentence that never existed before, and the ABSENCE of the
  // old sentence — which the re-review removed because this figure totals
  // account balances, not the holdings market value the page headlines.
  check(
    'retirement (FU): the sentence says "combined balance", the corrected basis',
    /combined balance of your investment accounts/i.test(curText),
  );
  check(
    'retirement (FU): the panel reconciles itself against the page’s "Portfolio value"',
    /balances your investment accounts report/i.test(curText) && /so the two can differ/i.test(curText),
  );
  check(
    'retirement (FU): the old "live balance of your investment accounts" claim is GONE',
    !/live balance of your investment accounts/i.test(curText),
  );
  await page.getByTestId('retirement-bar-40').click();

  // A projected bar REFUSES: it says the bar is a projection, not a transaction set.
  await page.getByTestId('retirement-bar-65').click();
  const projPanel = page.getByTestId('retirement-bar-panel-65');
  await projPanel.waitFor({ state: 'visible', timeout: 10000 });
  const projText = await projPanel.innerText();
  check(
    'retirement: a projected bar refuses honestly (no rows to show)',
    /projection|projected/i.test(projText),
  );

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
