/**
 * Deploy proof for U.23 (DECISIONS #457), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, same doctrine as the U.5/
 * U.9/U.13/U.16/U.19 scripts:
 *
 *   U.23 has NO demo-visible marker, and unlike U.19 it deliberately CANNOT
 *   have one. Its two effects are (a) split PARENT containers stop exporting
 *   and (b) non-USD accounts stop exporting and get a note — and `prisma/seed.ts`
 *   writes neither a split nor a non-USD account, because the demo user is the
 *   shared all-USD row every parallel spec reads. This is the K.4 situation and
 *   it is declared, not papered over: the behavioural proof is
 *   `tests/unit/u23-export-register-parity.test.ts` (19 locks against a real
 *   Prisma database, both halves proven fail-old by sabotage) plus the extended
 *   UI split in `tests/e2e/transaction-detail.spec.ts`, both on the CI gate.
 *
 *   What this script CAN prove, and what carries the real deployment risk: the
 *   route now runs the REGISTER'S where-clause instead of its own, against the
 *   production database, on 800+ real seeded rows. So it asserts the parity
 *   claim itself — the exported row count equals the number of transactions the
 *   register says it has — and the INERTNESS the decision promised: the header
 *   does not move, and an all-USD reader gets no currency note. A stale deploy
 *   cannot fail these, but a BROKEN one can: a bad clause, a Prisma error on the
 *   new AND-wrapped complement query, or a 500 from the route all surface here,
 *   and none of them would show up in a status code fetched from a page.
 *
 * Read-only: one-click demo sign-in, page reads and one CSV fetch, writes
 * nothing.
 *
 *   node scripts/u23-live-deploy-check.mjs
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

const browser = await chromium.launch();
const ctx = await browser.newContext(mobile);
const page = await ctx.newPage();

try {
  console.log(`U.23 live check against ${BASE}\n`);

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click({ timeout: 30_000 });
  await page.waitForURL('**/dashboard', { timeout: 40_000 });
  check('demo sign-in reaches the dashboard', true);

  // ── The route still answers, on the new clause, against production data ────
  const res = await page.request.get(`${BASE}/api/export?format=transactions-csv`);
  check('the transactions CSV export answers 200', res.ok(), `status ${res.status()}`);
  const csv = await res.text();
  const lines = csv.split('\r\n').filter((l) => l.length > 0);
  const header = lines[0] ?? '';
  const dataRows = lines.slice(1).filter((l) => !l.startsWith('"Note:'));

  // ── The decision's own promise: the header did NOT move (U.23 chose the
  //    guard over a currency column, so the schema U.19 fixed is untouched) ───
  check(
    'the CSV header is unchanged — U.23 added no column',
    header === 'date,account,description,merchant,category,amount,status,changeover_day',
    header,
  );
  check('the demo CSV has data rows', dataRows.length > 1, `${dataRows.length} rows`);

  // ── PARITY, the slice's central claim, measured live on real rows ──────────
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  let registerCount = null;
  const deadline = Date.now() + 25_000;
  do {
    const body = await page.locator('body').innerText().catch(() => '');
    const m = body.match(/([\d,]+)\s+transactions?\b/);
    if (m) registerCount = Number(m[1].replace(/,/g, ''));
    else await page.waitForTimeout(500);
  } while (registerCount === null && Date.now() < deadline);

  check(
    'the register states a transaction count',
    registerCount !== null,
    registerCount === null ? 'count line never painted' : `${registerCount}`,
  );
  check(
    'DISCRIMINATES THE CLAUSE: exported rows === the register\'s own count',
    registerCount !== null && dataRows.length === registerCount,
    `export ${dataRows.length} vs register ${registerCount}`,
  );

  // ── Inertness for an all-USD reader: the new note must be absent ───────────
  check(
    'no currency note on an all-USD file — the note is fact-gated, not always-on',
    !csv.includes('this file leaves out'),
    '',
  );
  check(
    'no note row of any kind on the demo file',
    !csv.includes('"Note:'),
    '',
  );
  check(
    'no account name is echoed by a withheld-currency sentence',
    !/not in U\.S\. dollars/.test(csv),
    '',
  );

  // ── The route's other formats still serve (the shared module was edited) ───
  const nw = await page.request.get(`${BASE}/api/export?format=net-worth-csv`);
  check('the net-worth CSV export still answers 200', nw.ok(), `status ${nw.status()}`);

  skipped(
    'a split parent absent from the file',
    'the demo seed writes no split — proven by tests/unit/u23-export-register-parity.test.ts (fail-old by sabotage) and the UI split in transaction-detail.spec.ts, both on the CI gate',
  );
  skipped(
    'a non-USD account withheld, and the note naming it',
    'the demo user is the shared all-USD row; reaching this live would require WRITING a foreign account to production',
  );
} finally {
  await browser.close();
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL / ${skip} declared SKIP`);
process.exit(fail === 0 ? 0 : 1);
