/**
 * Deploy proof for U.19/U.20/U.21/U.22 (DECISIONS #456), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, same doctrine as the U.5/
 * U.9/U.13/U.16 scripts:
 *
 *   Most of this slice discloses the released handover day, and reaching one
 *   needs an `AccountReconciliation` row that `prisma/seed.ts` never writes. So
 *   the register marker, the totals-caption sentence, the CSV `yes` rows and
 *   trailing note, the /reports total note, and every zero-branch sentence are
 *   all UNREACHABLE on the demo, and are declared as explicit SKIPs.
 *
 *   UNLIKE its four predecessors, this slice ships ONE demo-visible string that
 *   differs between builds: the transactions CSV's `changeover_day` header
 *   column is UNCONDITIONAL (one schema for every reader — DECISIONS #456), so
 *   the export header DISCRIMINATES the deployment even for a reader with no
 *   combined accounts. That is the one check here that can actually fail on a
 *   stale deploy, and it is asserted first.
 *
 *   The rest asserts the half that carries the real deployment risk: this slice
 *   edited `spendingByCategory` (again), `summarizeTransactions` (the register's
 *   three tiles), `merchantSpend`, both TxnView builders, and the CSV writer —
 *   and every edit must be INERT for a reader with no combined accounts. The
 *   demo IS that reader: its figures must be unmoved and every new marker and
 *   sentence correctly ABSENT.
 *
 * Read-only: one-click demo sign-in, page reads and one CSV fetch, writes
 * nothing.
 *
 *   node scripts/u19-live-deploy-check.mjs
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

/** Poll until the client render has painted money (see u16 script for why). */
async function paintedText(page, ms = 20_000) {
  const deadline = Date.now() + ms;
  let text = '';
  do {
    text = await page.locator('body').innerText().catch(() => '');
    if (MONEY.test(text)) return text;
    await page.waitForTimeout(500);
  } while (Date.now() < deadline);
  return text;
}

const browser = await chromium.launch();
const ctx = await browser.newContext(mobile);
const page = await ctx.newPage();

try {
  console.log(`U.19–U.22 live check against ${BASE}\n`);

  // ── Demo sign-in ───────────────────────────────────────────────────────────
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click({ timeout: 30_000 });
  await page.waitForURL('**/dashboard', { timeout: 40_000 });
  check('demo sign-in reaches the dashboard', true);

  // ── U.19: the ONE discriminating check — the CSV header changed for everyone ─
  const res = await page.request.get(`${BASE}/api/export?format=transactions-csv`);
  check('the transactions CSV export answers 200', res.ok(), `status ${res.status()}`);
  const csv = await res.text();
  const lines = csv.split('\r\n').filter((l) => l.length > 0);
  const header = lines[0] ?? '';
  check(
    'DISCRIMINATES THE BUILD: the CSV header carries the unconditional changeover_day column',
    header === 'date,account,description,merchant,category,amount,status,changeover_day',
    header,
  );
  check('the demo CSV has data rows', lines.length > 1, `${lines.length - 1} rows`);
  // Inertness: a reader with no combined accounts gets the empty column and no note.
  check(
    'no demo row is marked yes — the column is empty for a reader with no combined pair',
    lines.slice(1).every((l) => !l.endsWith(',yes')),
  );
  check('no trailing note row on a demo file', !csv.includes('Note: rows marked yes'), '');

  // ── U.20: the register — marker and caption sentence must be ABSENT ────────
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  const regText = await paintedText(page);
  check('the register still paints its three tiles', MONEY.test(regText), (regText.match(MONEY) ?? ['(none)'])[0]);
  check(
    'the caption still carries its pre-U.20 basis sentence',
    regText.includes('Totals include pending charges'),
  );
  const regMarkers = await page.getByTestId('txn-handover-row').count();
  check('no register row is marked for a reader with no combined accounts', regMarkers === 0, `${regMarkers} markers`);
  const regCaption = await page.getByTestId('txn-summary-handover').count();
  check('no handover sentence in the totals caption', regCaption === 0);
  check('the register nowhere says "changing connections"', !regText.includes('changing connections'));

  // ── U.21/U.22: /reports — total unmoved, notes absent ─────────────────────
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  const reportsText = await paintedText(page);
  check(
    'the /reports figure U.16 pinned is byte-identical ($299.93) — spendingByCategory is inert',
    reportsText.includes('$299.93'),
    (reportsText.match(MONEY) ?? ['(none)'])[0],
  );
  const totalNote = await page.getByTestId('reports-handover-total').count();
  check('no page-total handover note (U.22) for a reader with no combined accounts', totalNote === 0);
  const emptyNote = await page.getByTestId('reports-handover-none').count();
  check('no zero-branch note (U.21) — the demo has spending, and no released rows', emptyNote === 0);
  check('/reports nowhere says "changing connections"', !reportsText.includes('changing connections'));

  // ── The two other pinned figures from the U.16 record ─────────────────────
  await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
  const budgetsText = await paintedText(page);
  check('the /budgets figure U.16 pinned is byte-identical ($4,900.00)', budgetsText.includes('$4,900.00'));

  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  const coachText = await paintedText(page);
  check('the /coach figure U.16 pinned is byte-identical ($2,763.00)', coachText.includes('$2,763.00'));

  // ── What the demo cannot express, declared rather than dressed up ──────────
  skipped(
    'a register row marked (connection changeover), and the totals-caption sentence',
    'needs an AccountReconciliation row; the seed writes none',
  );
  skipped('a CSV with yes rows and the trailing note', 'same — no combined pair can exist on the demo');
  skipped(
    'the Ask zero-branch and merchant_spend disclosures, and their traces',
    'same — no released day can exist; locked by 25 unit tests + the seeded e2e in CI',
  );
  skipped(
    'the /reports page-total note rendering its count',
    'same — discriminating proof is tests/e2e/handover-day-disclosure.spec.ts on the CI gate',
  );
} finally {
  await browser.close();
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL / ${skip} declared SKIP`);
process.exit(fail === 0 ? 0 : 1);
