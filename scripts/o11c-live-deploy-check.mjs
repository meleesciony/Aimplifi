/**
 * Deploy proof for O.11c, run against PRODUCTION (www.aimplifi.app).
 *
 * O.11c made a positive `reimbursement`-categorized row count on NEITHER side
 * of the flow figures (`isReimbursementInflow`, consumed by `monthlyFlows` and
 * the glass-box panel), and re-derived the basis copy both panels state.
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated up front:
 *
 *  - The demo seed (prisma/seed.ts) contains NO reimbursement-categorized row,
 *    so this check CANNOT behaviorally discriminate the new figures — no demo
 *    number differs between the pre- and post-O.11c builds (the live corpus
 *    probe measured 0 such rows too). The behavioral discriminators are the
 *    unit locks (insights/month-flow-breakdown/spend-class suites) and the
 *    targeted e2e, which ran green on exactly this sha.
 *  - What production CAN discriminate is that the deployment serves the
 *    reports month-flow panels with the NEW basis sentences: both panels'
 *    copy changed in this slice, so the sentences are markers unique to this
 *    change, rendered by the shipped build. A stale deployment (an old build
 *    answering 200) fails this — the old copy does not contain them.
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/o11c-live-deploy-check.mjs
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
  // The one-click demo sign-in is intermittently slow in production (observed
  // 2026-09-25: 2 of 4 navigations timed out mid-deploy). Retry the entry
  // rather than reporting a harness flake as a deploy failure.
  let signedIn = false;
  let lastErr = '';
  for (let i = 0; i < 3 && !signedIn; i++) {
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('demo-sign-in').click({ timeout: 15000 });
      await page.waitForURL('**/dashboard', { timeout: 45000 });
      signedIn = true;
    } catch (e) {
      lastErr = String(e).split('\n')[0];
    }
  }
  check('demo: one-click sign-in reached the dashboard', signedIn, signedIn ? 'after retries' : lastErr);
  if (!signedIn) throw new Error(`demo sign-in failed after retries: ${lastErr}`);

  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  const picker = page.getByTestId('month-flow-picker');
  await picker.waitFor({ timeout: 30000 });
  const monthButtons = page.locator('[data-testid^="month-flow-month-"]');
  const count = await monthButtons.count();
  check('reports: the flow chart drew bars', count > 0, `months=${count}`);

  await monthButtons.last().click();
  const panels = page.getByTestId('month-flow-panels');
  await panels.waitFor({ timeout: 30000 });
  // innerText hides collapsed/clipped nodes; the basis paragraph is what the
  // e2e asserts via toContainText on the panel element, so read textContent
  // from each panel element the same way.
  const incomePanel = page.locator('[data-testid$="-income"][data-testid^="month-flow-panel-"]').first();
  const expensePanel = page.locator('[data-testid$="-expense"][data-testid^="month-flow-panel-"]').first();
  const incomeText = (await incomePanel.textContent()) ?? '';
  const expenseText = (await expensePanel.textContent()) ?? '';

  // The two sentences this slice rewrote — markers unique to the O.11c build.
  // The income basis now names the reimbursement carve-out...
  check(
    'reports: the income panel states the new reimbursement clause',
    incomeText.includes('counts on neither side'),
    'MONTH_FLOW_BASIS.income',
  );
  // ...and the expense basis names the same leaf on its own side.
  check(
    'reports: the expense panel states the new reimbursement clause',
    expenseText.includes('counts against neither this figure nor the income one'),
    'MONTH_FLOW_BASIS.expense',
  );

  check('reports: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  check('script completed', false, String(e).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? 'DEPLOY PROOF: PASS' : `DEPLOY PROOF: FAIL (${failed} failed)`);
process.exitCode = failed === 0 ? 0 : 1;
