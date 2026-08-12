/**
 * Deploy proof for U.3 (DECISIONS #449), run against PRODUCTION.
 *
 * U.3 closed the mortgage dead-end: /accounts rows route by the register's
 * own type set, loan-type rows expand an in-place detail panel, and the
 * register names a `?account=` it cannot show. Every check below reads a
 * rendered surface the OLD build fails:
 *
 *   /accounts       subtitle "Tap an account to open it." (was "…see its
 *                   transactions.") and the Auto Loan row's href is
 *                   /accounts?detail=acct-autoloan (was /transactions?…)
 *   /accounts       clicking Auto Loan opens the panel: role line, APR 6.49%,
 *                   recorded balance history (the seed's 162 snapshots)
 *   /transactions   ?account=acct-autoloan renders txn-empty-account-not-here
 *                   naming "Auto Loan", the select DISPLAYS Auto Loan, and the
 *                   count line reads "0 transactions in an account this page
 *                   can't show"
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/u3-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const mobile = { ...devices['Pixel 5'], viewport: { width: 380, height: 800 } };

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

  /* ── /accounts: honest subtitle + the loan row's new destination ── */
  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  const loanRow = page.getByTestId('account-row').filter({ hasText: 'Auto Loan' });
  await loanRow.waitFor({ timeout: 30000 });
  check(
    'accounts: subtitle says "Tap an account to open it."',
    (await page.locator('main').textContent())?.includes('Tap an account to open it.') ?? false,
  );
  const href = await loanRow.getAttribute('href');
  check(
    'accounts: Auto Loan row toggles its detail, never the register',
    href === '/accounts?detail=acct-autoloan',
    `href=${href}`,
  );

  /* ── the panel opens with the seed's facts ── */
  await loanRow.click();
  const panel = page.getByTestId('account-detail-panel');
  await panel.waitFor({ state: 'visible', timeout: 15000 });
  const panelText = await panel.textContent();
  check('accounts: panel states the net-worth role', panelText.includes('money you owe'));
  // Data-adaptive (the O.20f allocation pattern): the PRODUCTION demo's loan
  // row carries aprBps + dueDayOfMonth but a NULL minimumPaymentCents (seed
  // drift vs the local dataset, observed 2026-08-11) — and the panel's
  // contract is to render exactly the held facts. Assert the two facts
  // production holds; the all-three case is locked by the CI e2e on the
  // seeded set and the unit renders.
  check(
    'accounts: panel carries the loan facts production holds',
    panelText.includes('APR 6.49%') && panelText.includes('due on day 5 of the month'),
  );
  check(
    'accounts: panel lists recorded balance history',
    (await page.getByTestId('account-detail-history').count()) === 1,
  );

  /* ── the register names the account it cannot show ── */
  await page.goto(`${BASE}/transactions?account=acct-autoloan`, { waitUntil: 'domcontentloaded' });
  const empty = page.getByTestId('txn-empty-account-not-here');
  await empty.waitFor({ timeout: 30000 });
  const emptyText = await empty.textContent();
  check(
    'transactions: the empty state names the loan, not "these filters"',
    emptyText.includes('“Auto Loan” is a loan account'),
  );
  const selectValue = await page.getByTestId('txn-filter-account').inputValue();
  const injected = await page.getByTestId('txn-filter-account-missing-option').textContent();
  check(
    'transactions: the select DISPLAYS the active loan filter',
    selectValue === 'acct-autoloan' && injected === 'Auto Loan',
    `value=${selectValue}, option=${injected}`,
  );
  check(
    "transactions: the count line names the account zero beside the tiles",
    (await page.getByTestId('txn-list').textContent()).includes('0 transactions in an account this page can’t show'),
  );

  check('no page errors across the tour', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
