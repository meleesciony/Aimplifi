/**
 * Deploy proof for U.25 + U.26 (DECISIONS #458), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, same doctrine as the U.5/
 * U.9/U.13/U.16/U.19/U.23 scripts:
 *
 *   UNLIKE U.23 — which had no demo-visible marker at all, because the seed
 *   writes neither a split nor a non-USD account — this slice is almost entirely
 *   reachable on the demo, and the checks below are real measurements rather
 *   than declared absences:
 *
 *     - the two new columns and the basis note are UNCONDITIONAL, so they
 *       discriminate the build for every reader;
 *     - `prisma/seed.ts` writes own-account TRANSFERS on the demo's checking and
 *       savings accounts (monthly savings sweep, a CarMax ACH, every card
 *       payment), so the `transfer` column, its `yes` rows and the transfer
 *       shape of the U.26 note are all live-visible;
 *     - and the central claim — that the file now says why its amount column
 *       does not reproduce the app's figure — is MEASURED here: the sum of the
 *       unmarked rows is compared against the register's own outflow tile on
 *       production data.
 *
 *   The seed writes NO `excludeFromTotals` row, so the excluded half of the note
 *   is the one declared SKIP; it is locked by the unit file's real-database
 *   fixture and by the e2e.
 *
 * Read-only: one-click demo sign-in, page reads and one CSV fetch, writes
 * nothing.
 *
 *   node scripts/u25-live-deploy-check.mjs
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

/**
 * Fields read from the END of the row. `account`, `description`, `merchant` and
 * `category` may be quoted and may contain commas, so counting forward past them
 * is unsafe; `amount`, `status` and the three flag columns never are.
 */
const fromEnd = (line) => {
  const f = line.split(',');
  return {
    amountCents: Math.round(Number(f[f.length - 5]) * 100),
    changeover: f[f.length - 3] === 'yes',
    excluded: f[f.length - 2] === 'yes',
    transfer: f[f.length - 1] === 'yes',
  };
};

const browser = await chromium.launch();
const ctx = await browser.newContext(mobile);
const page = await ctx.newPage();

try {
  console.log(`U.25–U.26 live check against ${BASE}\n`);

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click({ timeout: 30_000 });
  await page.waitForURL('**/dashboard', { timeout: 40_000 });
  check('demo sign-in reaches the dashboard', true);

  const res = await page.request.get(`${BASE}/api/export?format=transactions-csv`);
  check('the transactions CSV export answers 200', res.ok(), `status ${res.status()}`);
  const csv = await res.text();
  const lines = csv.split('\r\n').filter((l) => l.length > 0);
  const header = lines[0] ?? '';
  const dataRows = lines.slice(1).filter((l) => !l.startsWith('"Note:'));

  // ── U.26: the schema discriminates the build for every reader ──────────────
  check(
    'DISCRIMINATES THE BUILD: the header carries excluded_from_totals and transfer',
    header ===
      'date,account,description,merchant,category,amount,status,changeover_day,' +
        'excluded_from_totals,transfer',
    header,
  );
  check(
    'the columns were APPENDED — amount is still field 5 for a reader\'s saved script',
    header.split(',')[5] === 'amount',
    header.split(',')[5],
  );
  check('the demo CSV has data rows', dataRows.length > 1, `${dataRows.length} rows`);

  // ── U.25: the basis note, unconditional, on a file that triggers nothing ───
  check(
    'DISCRIMINATES THE BUILD: every file states its basis',
    csv.includes('Note: this file lists transactions from your spending accounts'),
  );
  const noteRows = lines.filter((l) => l.startsWith('"Note:'));
  const basisNote = noteRows.find((l) => l.startsWith('"Note: this file lists')) ?? '';
  check(
    'the basis note states a RULE and enumerates no omission',
    basisNote !== '' && !/mortgage|brokerage|investment|split/i.test(basisNote),
    basisNote.slice(0, 60),
  );
  check(
    // Both critics executed the first draft's counterexample HERE, on this very file:
    // it closed "it is not every transaction row Aimplifi has stored" while exporting
    // all 847 rows the demo stores. Every clause is now a rule about the file.
    'the basis note asserts nothing about what the reader happens to hold',
    basisNote.includes('whether or not you hold one') &&
      !basisNote.includes('does not cover every account you hold') &&
      !basisNote.includes('not every transaction row Aimplifi has stored'),
  );

  // ── U.26 on real rows: the demo's transfers are marked, and explained ──────
  const parsed = dataRows.map(fromEnd);
  const transfers = parsed.filter((r) => r.transfer);
  check(
    'the demo\'s own-account transfers are marked in the file',
    transfers.length > 0,
    `${transfers.length} of ${parsed.length} rows`,
  );
  check(
    'and the note explains the flag that is present',
    /rows marked yes in transfer/i.test(csv),
  );
  check(
    'the note names only that flag — the demo has excluded no row',
    !csv.includes('rows marked yes in excluded_from_totals'),
  );
  check(
    // Scoped to the NOTE rows, not the whole file: a reader's descriptor or merchant name
    // can contain any of these words, so running the regex over 847 rows of their data
    // would make this gate's verdict depend on what they bought.
    'it states no direction and promises no equality',
    !/higher|larger|too high|overstate|reproduce|matches /i.test(noteRows.join('\n')),
  );
  check(
    'it claims nothing app-wide: the three named figures are the register\'s own tiles',
    /the money-in, money-out and net figures on Aimplifi.s Transactions page/.test(csv) &&
      !csv.includes('the spending, income and net totals it shows'),
  );
  check(
    'it keeps the money real without vouching for a balance',
    csv.includes('The rows are still real transactions') &&
      !/account balances/i.test(noteRows.join('\n')),
  );
  check(
    // `isTransfer` is descriptor-evidence in the demo's own CarMax rows, whose loan account
    // holds no transaction the file could carry — so the note may not promise a counterpart.
    'the transfer clause asserts no counterpart and no ownership',
    !csv.includes('accounts you own') && !csv.includes('matching row'),
  );

  // ── The central claim, MEASURED against the register's own tile ────────────
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  let outText = null;
  const deadline = Date.now() + 25_000;
  do {
    outText = await page.getByTestId('summary-out').innerText().catch(() => null);
    if (!outText || !MONEY.test(outText)) {
      outText = null;
      await page.waitForTimeout(500);
    }
  } while (outText === null && Date.now() < deadline);
  check(
    'the register paints its outflow tile',
    outText !== null,
    outText ?? 'never painted',
  );

  // What the app says went out, and what the file's unmarked rows say went out.
  // Equal is the whole point of U.26: before this slice a reader could not sort
  // the file into the two groups at all, so no arithmetic they did on the amount
  // column could land on the app's figure.
  const registerOut = outText === null ? null : Math.round(Number((outText.match(/[\d,]+\.\d{2}/) ?? ['0'])[0].replace(/,/g, '')) * 100);
  const unmarkedOut = parsed
    .filter((r) => !r.excluded && !r.transfer && r.amountCents < 0)
    .reduce((n, r) => n - r.amountCents, 0);
  const allRowsOut = parsed.filter((r) => r.amountCents < 0).reduce((n, r) => n - r.amountCents, 0);
  check(
    'MEASURED: the unmarked rows sum to the register\'s outflow tile',
    registerOut !== null && unmarkedOut === registerOut,
    `file ${unmarkedOut} vs register ${registerOut}`,
  );
  check(
    'and the gap the flags explain is real, not cosmetic',
    allRowsOut !== unmarkedOut,
    `every row ${allRowsOut} vs unmarked ${unmarkedOut}`,
  );

  // ── Inertness: this slice changed no figure anywhere ──────────────────────
  // POLLED, not read once. The outflow tile above paints roughly three seconds
  // before this caption does, so a single body read taken the moment the tile
  // appears reports the caption missing — measured on production, and it cost
  // this script a red run that looked like a copy regression until the sentence
  // was probed directly and found intact.
  let regText = '';
  const capDeadline = Date.now() + 20_000;
  do {
    regText = await page.locator('body').innerText().catch(() => '');
    if (!regText.includes('Totals include pending charges')) await page.waitForTimeout(500);
  } while (!regText.includes('Totals include pending charges') && Date.now() < capDeadline);
  check(
    'the caption still carries its pre-U.20 basis sentence',
    regText.includes('Totals include pending charges'),
  );
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  let reportsText = '';
  const rDeadline = Date.now() + 20_000;
  do {
    reportsText = await page.locator('body').innerText().catch(() => '');
    if (!MONEY.test(reportsText)) await page.waitForTimeout(500);
  } while (!MONEY.test(reportsText) && Date.now() < rDeadline);
  check(
    'the /reports figure U.16 pinned is byte-identical ($299.93)',
    reportsText.includes('$299.93'),
    (reportsText.match(MONEY) ?? ['(none)'])[0],
  );

  skipped(
    'a row marked yes in excluded_from_totals, and the excluded half of the note',
    'prisma/seed.ts writes no excludeFromTotals row; locked by the real-database fixture in tests/unit/u25-u26-export-basis-and-flags.test.ts and by the e2e',
  );
  skipped(
    'the both-flags note shape ("Both kinds are left out of…")',
    'same — needs an excluded row alongside the demo\'s transfers',
  );
} finally {
  await browser.close();
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL / ${skip} declared SKIP`);
process.exit(fail === 0 ? 0 : 1);
