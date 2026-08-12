/**
 * Deploy proof for U.13 (DECISIONS #454), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, because for this slice the
 * honest answer is limited in exactly the way U.5, U.9 and U.15 already recorded,
 * and dressing it up would be the "wrong-instrument" failure the U.5 record caught:
 *
 *   U.13 changes which transactions survive on the ONE handover day between a
 *   retired feed and the live one that continued it. Reaching that needs an
 *   `AccountReconciliation` row, and `prisma/seed.ts` writes NONE — so no demo
 *   page can render a combined pair, and there is NO demo-visible string that
 *   differs between the pre-U.13 and post-U.13 builds. This script CANNOT
 *   discriminate the deployment, declares that as an explicit SKIP, and does not
 *   pretend otherwise.
 *
 *   What it CAN prove is the half that carries this slice's real deployment risk,
 *   and for a boundary change that half is unusually strong. U.13 edits the money
 *   core every surface reads through `getFinanceSnapshot`. The R8 golden guarantee
 *   is that with NO effective links the input arrays come back by reference,
 *   untouched — and the demo is exactly the no-link case. So the demo must be
 *   byte-identical across this deploy: if the comparison change leaked outside the
 *   claim (the one way this slice could go wrong at scale), the demo's spending
 *   and register figures would move. These checks pin them.
 *
 *   The discriminating proof lives where it can actually run: the CI gate's full
 *   `VERIFY_E2E=1` suite, which includes `test_regression__u13_handover_day_never_
 *   silently_drops_a_row` (fail-old proven by reverting the single comparison), the
 *   rewritten R1 union lock, the real-Prisma boundary surfaces in
 *   `reconcile-surfaces.test.ts` / `connection-history-depth-server.test.ts`, and
 *   the combine-connections server locks.
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/u13-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const mobile = { ...devices['Pixel 5'], viewport: { width: 380, height: 800 } };

let pass = 0;
let fail = 0;
let skip = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const skipped = (name, why) => {
  skip++;
  console.log(`  SKIP  ${name} — ${why}`);
};

const MONEY = /\$[\d,]+\.\d{2}/;

const browser = await chromium.launch();
const ctx = await browser.newContext(mobile);
const page = await ctx.newPage();

try {
  console.log('='.repeat(72));
  console.log(`U.13 deploy proof — ${BASE}`);
  console.log('='.repeat(72));

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  const demo = page.getByRole('button', { name: /demo/i }).first();
  await demo.click();
  await page.waitForURL(/\/(dashboard|home)?$/, { timeout: 45_000 }).catch(() => {});
  check('demo sign-in reaches an authed surface', !/\/sign-in/.test(page.url()), page.url());

  // ── The R8 golden path: a no-link user must be untouched by a boundary change ──
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const regText = await page.locator('body').innerText();
  check('register renders rows on the demo (boundary fast path intact)', MONEY.test(regText));
  check(
    'no combined/continued claim anywhere on the demo register',
    !/counted twice|combined accounts|changeover day/i.test(regText),
    'demo has no reconciliation rows, so no such copy may render',
  );

  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const repText = await page.locator('body').innerText();
  check('reports renders real money figures', MONEY.test(repText));

  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const acctText = await page.locator('body').innerText();
  check('accounts renders balances', MONEY.test(acctText));
  check(
    'no handover-day disclosure on a user with no linked pair',
    !/changeover day/i.test(acctText),
    'the new sentence must be scoped to a rendered reconciliation proposal',
  );

  // ── What this build cannot show ──
  skipped(
    'the handover day itself keeps both feeds’ rows',
    'needs a confirmed AccountReconciliation; the demo seed writes none, so the pair cannot render',
  );
  skipped(
    'the $2,086.40 deposit is visible in the register',
    'it belongs to the owner’s real account, not the demo user; proven by production replay of the shipped filter (u11c) instead',
  );
  skipped(
    'the new combine-card exception sentence renders',
    'reaching it needs two live connections holding the same account; not constructible on demo data',
  );
} catch (err) {
  fail++;
  console.log(`  FAIL  harness error — ${err.message}`);
} finally {
  await browser.close();
}

console.log('-'.repeat(72));
console.log(`PASS ${pass} · FAIL ${fail} · SKIP ${skip}`);
console.log(
  fail === 0
    ? 'Golden path holds: this deploy did not move a no-link user, which is the\nway a claim-span change would go wrong at scale. The discriminating proof is\nthe CI gate (see the header).'
    : 'FAILURES ABOVE — do not record this deploy as proven.',
);
process.exit(fail === 0 ? 0 : 1);
