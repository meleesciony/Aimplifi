/**
 * Deploy proof for U.5 (DECISIONS #452), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, because the reachable half
 * of U.5 is invisible on the demo and saying so is the point:
 *
 *   U.5 marks the recorded balances the net-worth trend does NOT count, which
 *   happens only for an account COMBINED with another (the reconciliation
 *   boundary keeps one side of each same-dated pair). The demo seed writes no
 *   `AccountReconciliation` rows at all, so no demo panel can produce a marked
 *   row, and every demo figure and sentence must be byte-identical to before.
 *
 *   CAN prove: that the deployed build is the U.5 build — the trend basis
 *   sentence gained the clause that admits the combine drop, on BOTH surfaces
 *   that draw the chart, asserted together with the ABSENCE of the wording it
 *   replaced (so a stale deployment cannot pass) — and that the half which must
 *   NOT move did not: the demo's Auto Loan panel still lists its recorded
 *   history with no "not in your net worth" marker and no new note, and the
 *   /accounts reconciliation cards still render their corrected claims.
 *
 *   CANNOT prove: the marker, the per-row counted-instead figure, and the note.
 *   Reaching them needs a confirmed reconciliation between two LOAN-class
 *   accounts that both hold a balance on one date — impossible on the demo
 *   without corrupting the golden dataset. Locked instead in a real browser by
 *   tests/e2e/no-dead-ends.spec.ts (a seeded combined pair at 380px), against
 *   real Prisma by tests/unit/account-detail-reconciled.test.ts (including the
 *   3-link chain), and as pure copy by tests/unit/balance-history-view.test.ts.
 *   Declared as SKIPs below, never silently omitted.
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/u5-live-deploy-check.mjs
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

/* The clause U.5 added, and the exact wording it replaced. Asserting BOTH
   directions is what makes this a build discriminator rather than a check an
   old deployment also passes. */
const NEW_CLAUSE = 'one per account, so accounts you have combined contribute the single balance kept for that date';
const OLD_JOIN = 'classed as then — an account it had no balance for then is not in it';

const browser = await chromium.launch();
const page = await browser.newPage(mobile);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  /* ── BUILD DISCRIMINATOR: the trend basis on both chart surfaces ────────── */
  const basis = page.getByTestId('net-worth-trend-basis');
  await basis.waitFor({ timeout: 30000 });
  const dashBasis = (await basis.textContent()) ?? '';
  check('dashboard: the trend basis admits the combine drop', dashBasis.includes(NEW_CLAUSE), dashBasis.slice(0, 140));
  check('dashboard: the pre-U.5 wording — which named ONLY a missing account — is GONE', !dashBasis.includes(OLD_JOIN));
  /* U.6's clause must survive verbatim: this slice edits the same sentence, and
     a rewrite that dropped it would silently revert U.6's disclosure. */
  check(
    'dashboard: U.6’s clause about the class each account was counted under still stands',
    dashBasis.includes('counted as what each account was classed as then'),
  );
  check(
    'dashboard: U.6’s sentence about a move between own and owe still stands',
    dashBasis.includes('points before and after that move are drawn on opposite sides'),
  );

  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  const acctBasis = page.getByTestId('accounts-net-worth-trend-basis');
  await acctBasis.waitFor({ timeout: 30000 });
  const acctBasisText = (await acctBasis.textContent()) ?? '';
  check('accounts: the same basis sentence, same admission', acctBasisText.includes(NEW_CLAUSE));
  check('accounts: and not the pre-U.5 wording', !acctBasisText.includes(OLD_JOIN));

  /* ── The half that must NOT move: the demo has no combined accounts ─────── */
  await page.goto(`${BASE}/accounts?detail=acct-autoloan`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByTestId('account-detail-panel');
  await panel.waitFor({ timeout: 30000 });
  check(
    'accounts: the demo Auto Loan panel still lists its recorded balance history',
    await page.getByTestId('account-detail-history').isVisible(),
  );
  check(
    'accounts: no row is marked as not counted — the demo combines nothing',
    (await page.getByTestId('account-detail-not-counted').count()) === 0,
  );
  check(
    'accounts: and no combined-balances note either',
    (await page.getByTestId('account-detail-not-counted-note').count()) === 0,
  );
  const panelText = (await panel.textContent()) ?? '';
  check('accounts: the panel’s role line is unchanged', panelText.includes('counts toward your net worth as money you owe'));
  check('accounts: the seeded loan facts are unchanged', panelText.includes('APR 6.49%'));

  skip('a row marked "your net worth counts <amount> from <account>"', 'needs a confirmed reconciliation between two LOAN-class accounts sharing a date — the demo seed writes no reconciliations; locked in e2e no-dead-ends.spec.ts at 380px');
  skip('the combined-balances note and its "Account cleanup" pointer', 'same reason — no demo panel can produce an uncounted row');
  /* Deliberately a SKIP and not a check: the demo offers no candidate and holds
     no combined pair, so NEITHER card renders — asserting the absence of their
     corrected strings would pass on every build ever deployed, measuring which
     components happened to render rather than which build is live (the
     wrong-instrument class the U.6 check was rewritten to avoid). */
  skip('the corrected reconciliation card copy in situ', 'the demo offers no candidate and holds no combined pair, so neither card renders; locked in tests/e2e/reconcile.spec.ts');
  skip('a chain naming no counterpart', 'needs a 3-link chain; locked against real Prisma in tests/unit/account-detail-reconciled.test.ts');

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
