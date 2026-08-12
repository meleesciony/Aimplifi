/**
 * Deploy proof for U.6 (DECISIONS #451), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, because for THIS slice the
 * honest scope is unusually narrow and saying so is the point:
 *
 *   U.6 deliberately changes NOTHING the demo can see. The demo's account types
 *   never change, so every row's recorded class equals its account's current
 *   class, every sign is identical, no "recorded as" marker can appear, and the
 *   delta still compares cleanly. That is the design — the golden dataset must
 *   stay byte-identical — and it means the usual proof shape (assert the new
 *   sentence AND the absence of the one it replaced) has nothing to assert.
 *
 *   CAN prove, and this is the real value: that the deployed build is the U.6
 *   build (the BUILD DISCRIMINATOR below), and that the half which must NOT move
 *   did not move. The new `netWorthDelta` refusal is the live risk in this slice
 *   — a class comparison that misfires would replace a real dollar figure with
 *   "No comparison" on /dashboard AND /accounts for every user including the
 *   demo. These checks would catch exactly that.
 *
 *   CANNOT prove: the reclassification behaviour itself — the per-row sign, the
 *   "recorded as <type>" marker, the note, and the delta refusal. Reaching them
 *   needs an account whose stored `accountType` differs from its current `type`,
 *   which no demo row has and which cannot be created without corrupting the
 *   golden dataset. Those are locked in a real browser instead, at mobile-380,
 *   by tests/e2e/no-dead-ends.spec.ts (hand-inserted disagreeing rows), and in
 *   the unit gate by networth-series / networth-panel / account-detail-panel /
 *   balance-history-server. Declared as SKIPs below, never silently omitted.
 *
 *   NOT APPLICABLE: production's pre-U.6 rows are deliberately never backfilled.
 *   A backfill could only copy the class the account carries TODAY, and every
 *   surface renders a non-null value as an OBSERVATION — so it would launder a
 *   guess into a record, and stamp the WRONG class, permanently and unmarkably,
 *   on any account reclassified before U.6 shipped. Those rows keep reading
 *   exactly as they did before U.6, and the panel says so when class is at issue.
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/u6-live-deploy-check.mjs
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

const browser = await chromium.launch();
const page = await browser.newPage(mobile);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  /* ── BUILD DISCRIMINATOR ───────────────────────────────────────────────────
     The trend basis sentence, which U.6 rewrote to name the second reason two
     points can differ (a class change). Asserting the NEW clause AND the absence
     of the OLD one is the U.4 shape, and it is rendered text rather than a
     payload token: an earlier draft of this check grepped the whole document for
     `isLiability`, which `household-sharing-card` also emits — so it measured
     which components happened to render, not which build was deployed. */
  const basis = page.getByTestId('net-worth-trend-basis');
  await basis.waitFor({ timeout: 30000 });
  const basisText = (await basis.textContent()) ?? '';
  check(
    'dashboard: the trend basis names the class a point counted each account under',
    basisText.includes('counted as what each account was classed as then'),
    basisText.slice(0, 120),
  );
  check(
    'dashboard: it says which way a reclassified account is drawn',
    basisText.includes('points before and after that move are drawn on opposite sides'),
  );
  check(
    'dashboard: the pre-U.6 sentence — which named ONLY a missing account — is GONE',
    !basisText.includes(
      'Each point is the balances the app had recorded on that date — an account it had no balance for then is not in it.',
    ),
  );

  /* ── The half that must NOT move (the demo's classes are stable) ── */
  const delta = page.getByTestId('net-worth-delta');
  await delta.waitFor({ timeout: 30000 });
  const deltaText = ((await delta.textContent()) ?? '').trim();
  check(
    'dashboard: the demo delta is still a figure vs last month-end, unchanged by design',
    deltaText.includes('vs last month-end'),
    deltaText,
  );
  check(
    'dashboard: the NEW class-change refusal does not misfire on stable classes',
    !deltaText.includes('changed between what you own and what you owe'),
    deltaText,
  );
  check(
    'dashboard: no refusal of any kind on the demo (its buckets are complete AND stable)',
    !deltaText.includes('No comparison'),
    deltaText,
  );

  /* ── /accounts: the same delta renders there, and the detail panel that
       paints per-row signs must show a mortgage's history as money OWED with no
       reclassification marker anywhere on a dataset that never reclassifies. ── */
  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  // /accounts renders its own net-worth card with its own testids (the
  // dashboard's are unprefixed) — a wrong selector here would time out and
  // "prove" nothing, the failure mode this script exists to avoid.
  const acctBasis = page.getByTestId('accounts-net-worth-trend-basis');
  await acctBasis.waitFor({ timeout: 30000 });
  check(
    'accounts: the SECOND chart carries the same rewritten basis (one shared sentence, both surfaces)',
    ((await acctBasis.textContent()) ?? '').includes(
      'counted as what each account was classed as then',
    ),
  );
  const acctDelta = page.getByTestId('accounts-net-worth-delta');
  await acctDelta.waitFor({ timeout: 30000 });
  const acctDeltaText = ((await acctDelta.textContent()) ?? '').trim();
  check(
    'accounts: the second surface renders the same unchanged delta',
    acctDeltaText.includes('vs last month-end') && !acctDeltaText.includes('No comparison'),
    acctDeltaText,
  );

  const loanRow = page.getByTestId('account-row-detail-cue').first();
  await loanRow.waitFor({ timeout: 30000 });
  await loanRow.click();
  const panel = page.getByTestId('account-detail-panel');
  await panel.waitFor({ timeout: 30000 });
  const panelText = (await panel.textContent()) ?? '';
  check(
    'accounts: the detail panel still renders recorded balance history',
    panelText.includes('Recorded balance history'),
  );
  check(
    'accounts: NO row claims it was counted under another class (the demo never reclassifies)',
    !panelText.includes('counted as'),
  );
  check(
    'accounts: and no row is flagged as predating the class column either',
    await page.getByTestId('account-detail-unrecorded-class-note').isHidden(),
  );
  check(
    'accounts: and no reclassification note either',
    await page.getByTestId('account-detail-reclassified-note').isHidden(),
  );

  skip('a row signed by its OWN recorded class', 'needs a stored accountType differing from the account today — impossible on the demo; locked in e2e no-dead-ends.spec.ts at 380px');
  skip('the "counted as <type>" row marker and its two notes', 'same reason — the demo has no reclassified row');
  skip('the delta refusing a class change', 'same reason; locked in tests/unit/networth-panel.test.ts');
  skip('the drilldown naming a constituent counted the other way', 'same reason; the demo never reclassifies');

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
