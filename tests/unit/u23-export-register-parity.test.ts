/**
 * U.23 — the transactions CSV exports the REGISTER'S basis, and says what the currency guard
 * kept out of it.
 *
 * Opened by the U.19–U.22 money critic against a real database: the export route built its own
 * where-clause, so the file it produced was not the ledger its own comment claimed. It shipped
 * the split PARENT container alongside the children that carry the real amounts — the schema
 * calls the parent "excluded from ALL sums" and a reader summing the amount column counted
 * every split twice — and it shipped rows from accounts the register withholds for having no
 * exchange rate, unlabelled, in a column of dollars. The repro measured 4 rows / -$299.00 out
 * of a ledger the register shows as 2 rows / -$100.00, and it is rebuilt verbatim below.
 *
 * The doctrine is the one U.19 set on this same file: every test guards a CLAIM. The parity
 * cases assert the file equals the register by construction (not by a hardcoded row count that
 * a second copy of the clause could satisfy while drifting); the disclosure cases assert what
 * the note may and may not say, and — the harder half — that it stays silent for every reader
 * who has nothing withheld, so their file is byte-identical to the one U.19 locked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));

import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { GET } from '@/app/api/export/route';
import { prisma } from '@/lib/db';
import { getTransactions, getWithheldAccountSummary } from '@/server/transactions';
import { transactionsToCsv, type ExportTxn } from '@/lib/export';
import { withheldExportNote } from '@/lib/providers/currency';

// ─── the note's copy, every grammar branch (the #141 rule for this family) ───

describe('U.23 — withheldExportNote', () => {
  it('is SILENT when nothing is withheld — an all-USD reader gets no note row at all', () => {
    expect(withheldExportNote({ count: 0, currencies: [] })).toBeNull();
  });

  it('says the transactions are not in the FILE — the fact its siblings do not state', () => {
    // The banner (#141) and the inline note (#150) both say a FIGURE excludes accounts. A
    // reader holding either sentence over a file of rows can conclude their rows are present
    // and merely un-summarised. This surface owes them the absence itself.
    const note = withheldExportNote({ count: 1, currencies: ['EUR'] })!;
    expect(note).toContain('none of its transactions are in this file');
    expect(note).toContain("leaves out one account that isn't in U.S. dollars (EUR)");
  });

  it('regression__u23_totals_clause_states_a_rule_not_a_count', () => {
    // Both U.23 critics, independently. The note's count is FILE-scoped (the accounts this
    // export could have carried); the banner's is app-scoped (every non-USD account, any
    // type). They legitimately differ — a euro checking plus a yen brokerage is "2 accounts"
    // on screen and one account here. The defect was spending the scoped count on an
    // app-scoped claim: "an account in EUR is left out of every total the app shows" is false
    // for that reader, because two accounts are. Every counted clause now names this file,
    // and the sentence about the app's totals carries no number at all.
    const note = withheldExportNote({ count: 1, currencies: ['EUR'] })!;
    expect(note).toContain("Accounts that aren't in U.S. dollars are left out of Aimplifi's totals");
    expect(note).not.toContain('every total the app shows');
    // The rule sentence must stay number-free: no digit and no article-count may attach to it.
    const totalsClause = note.slice(note.indexOf('Accounts that'));
    expect(totalsClause).not.toMatch(/\d/);
    // ...and the counted clause is explicitly about the file.
    expect(note).toContain('this file leaves out one account');
  });

  it('states the assumption inline and keeps the guardrails: no shame, no ship date', () => {
    const note = withheldExportNote({ count: 2, currencies: ['EUR', 'GBP'] })!;
    // Why the rows are absent, in the same breath as the absence.
    expect(note).toContain("can't convert other currencies to U.S. dollars yet");
    expect(note).toContain('one-to-one rate would be inaccurate');
    // Nothing was destroyed, and the reader is not at fault for holding a euro account.
    // "Saved" NAMES Aimplifi: in a downloaded file an unplaced "stays saved" can be read as a
    // promise about the file the reader is holding, which is the one thing it is not.
    expect(note).toContain('stay saved in Aimplifi');
    expect(note).not.toMatch(/unsupported|invalid|sorry|unfortunately/i);
    // No promised ship date — the #141 guardrail this family has kept since the banner.
    expect(note).not.toMatch(/soon|coming|will be|planned|roadmap/i);
    // "not in U.S. dollars", never "foreign": crypto is a first-class withheld case.
    expect(note).not.toMatch(/foreign/i);
  });

  it('agrees with itself on number: singular and plural are separate branches', () => {
    const one = withheldExportNote({ count: 1, currencies: ['EUR'] })!;
    expect(one).toContain("leaves out one account that isn't in U.S. dollars (EUR)");
    expect(one).toContain('none of its transactions');
    expect(one).toContain('the account and its history stay saved');
    const two = withheldExportNote({ count: 2, currencies: ['EUR', 'GBP'] })!;
    expect(two).toContain("leaves out 2 accounts that aren't in U.S. dollars (EUR, GBP)");
    expect(two).toContain('none of their transactions');
    expect(two).toContain('the accounts and their history stay saved');
  });

  it('names the account ONCE — the second mention is definite, not a second account', () => {
    // "…leaves out an account… so an account in EUR is left out…" gave one account two
    // indefinite articles, and nothing told the reader they were the same one.
    const note = withheldExportNote({ count: 1, currencies: ['EUR'] })!;
    expect(note.match(/\bone account\b/g)).toHaveLength(1);
    expect(note).not.toMatch(/\ban account\b/);
    // The pronoun after the dash has a named referent, not a bare "them".
    expect(note).toContain('counting those transactions in a column of dollars');
  });

  it('drops the parenthetical for an opaque token — never pastes a feed token', () => {
    // A SimpleFIN currency URL / numeric ISO code / 2-letter fragment is a feed token, not a
    // display name (#141). With nothing printable to name, the sentence says the whole of what
    // it can honestly say and stops: "(other currencies)" would add noise, not information.
    const note = withheldExportNote({ count: 1, currencies: ['https://x.test/doge'] })!;
    expect(note).toContain("leaves out one account that isn't in U.S. dollars.");
    expect(note).not.toContain('https://x.test/doge');
    expect(note).not.toContain('(');
  });
});

// ─── the file: the note rides it exactly like U.19's, and never alone ────────

const csvRow = (over: Partial<ExportTxn> = {}): ExportTxn => ({
  date: '2026-07-10',
  account: 'Checking',
  rawDescriptor: 'COSTCO WHSE #0482',
  merchant: 'Costco',
  category: 'Groceries',
  amountCents: -5_000,
  status: 'POSTED',
  onHandoverDay: false,
  ...over,
});

describe('U.23 — the transactions CSV carries the withheld-currency note', () => {
  it('a reader with nothing withheld gets the file U.19 locked, unchanged', () => {
    const out = transactionsToCsv([csvRow()], { count: 0, currencies: [] });
    const lines = out.split('\r\n');
    // header + 1 row + trailing '' from the final CRLF. No note row.
    expect(lines).toHaveLength(3);
    expect(out).not.toContain('Note:');
  });

  it('the note is rectangular, like every other note this file emits', () => {
    const out = transactionsToCsv([csvRow()], { count: 1, currencies: ['EUR'] });
    const note = out.split('\r\n')[2];
    expect(note.startsWith('"Note: this file leaves out one account')).toBe(true);
    // The prose occupies field 1 and seven empty fields follow, so a parser reading the file
    // as a table sees one row of the declared width rather than a ragged tail.
    expect(note.endsWith(',,,,,,,')).toBe(true);
  });

  it('the header does not move — the column schema is the one U.19 made unconditional', () => {
    const out = transactionsToCsv([csvRow()], { count: 1, currencies: ['EUR'] });
    expect(out.split('\r\n')[0]).toBe(
      'date,account,description,merchant,category,amount,status,changeover_day',
    );
  });

  it('both notes can ride one file, in a fixed order, each rectangular', () => {
    // A reader with a combined pair AND a euro account gets two true sentences, not one of
    // them: neither disclosure may suppress the other (the U.21 lesson — a disclosure gated
    // to the loudest case misses the reachable one).
    const out = transactionsToCsv([csvRow({ onHandoverDay: true })], {
      count: 1,
      currencies: ['EUR'],
    });
    const lines = out.split('\r\n');
    expect(lines[2].startsWith('"Note: rows marked yes in changeover_day')).toBe(true);
    expect(lines[3].startsWith('"Note: this file leaves out one account')).toBe(true);
    expect(lines[2].endsWith(',,,,,,,')).toBe(true);
    expect(lines[3].endsWith(',,,,,,,')).toBe(true);
  });
});

// ─── the route, against a real database: the critic's repro, rebuilt ─────────

describe('U.23 — GET /api/export?format=transactions-csv equals the register', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `u23-${stamp}`;
  let parentId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.rateLimit.deleteMany({ where: { key: `export:${USER}` } });
  }

  beforeAll(async () => {
    await wipe().catch(() => {});
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const usd = await prisma.account.create({
      data: {
        userId: USER, provider: 'simplefin', name: 'U23 Checking',
        type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD',
      },
    });
    // A $100.00 purchase the reader split 60/40. The PARENT is the container the split
    // replaced; its children carry the real amounts, so a file holding all three states
    // $200.00 of spending where $100.00 happened.
    const parent = await prisma.transaction.create({
      data: {
        accountId: usd.id, date: '2026-07-03', amountCents: -10_000,
        rawDescriptor: 'U23 SPLIT PARENT CONTAINER', status: 'POSTED',
        isTransfer: false, isSplitParent: true,
      },
    });
    parentId = parent.id;
    for (const [descriptor, amountCents] of [
      ['U23 SPLIT CHILD SIXTY', -6_000],
      ['U23 SPLIT CHILD FORTY', -4_000],
    ] as const) {
      await prisma.transaction.create({
        data: {
          accountId: usd.id, date: '2026-07-03', amountCents,
          rawDescriptor: descriptor, status: 'POSTED',
          isTransfer: false, isSplitParent: false, splitParentId: parent.id,
        },
      });
    }
    // A euro account: real rows, no exchange rate, withheld from every figure the app shows
    // (DECISIONS #135) — and, until this slice, exported into a column of dollars anyway.
    const eur = await prisma.account.create({
      data: {
        userId: USER, provider: 'simplefin', name: 'U23 Euro Checking',
        type: 'CHECKING', currentBalanceCents: 50_000, currency: 'EUR',
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: eur.id, date: '2026-07-04', amountCents: -9_900,
        rawDescriptor: 'U23 EURO ROW', status: 'POSTED',
        isTransfer: false, isSplitParent: false,
      },
    });
  });
  afterAll(wipe);

  async function exportCsv(): Promise<string> {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    // The route's durable limit is 10 exports per 60s and this block is well inside one
    // window; without clearing, the eleventh assertion in this file would fail as a 429 and
    // read as a parity defect. Cleared per call so the count can never be the reason a
    // future case goes red.
    await prisma.rateLimit.deleteMany({ where: { key: `export:${USER}` } });
    const res = await GET(
      new NextRequest('http://localhost/api/export?format=transactions-csv'),
    );
    expect(res.status).toBe(200);
    return res.text();
  }

  const dataRows = (csv: string) =>
    csv.split('\r\n').slice(1).filter((l) => l.length > 0 && !l.startsWith('"Note:'));

  it('the fixture is leak-worthy: all four rows exist and the old clause would ship them', async () => {
    // Without this, every assertion below could pass against an empty database.
    const all = await prisma.transaction.findMany({
      where: { account: { userId: USER } },
      select: { id: true },
    });
    expect(all).toHaveLength(4);
    expect(parentId).not.toBe('');
  });

  it('exports the two split CHILDREN and not the parent container', async () => {
    const csv = await exportCsv();
    expect(csv).toContain('U23 SPLIT CHILD SIXTY');
    expect(csv).toContain('U23 SPLIT CHILD FORTY');
    // The row the schema calls "excluded from ALL sums".
    expect(csv).not.toContain('U23 SPLIT PARENT CONTAINER');
  });

  it('withholds the non-USD rows the register withholds, and never their account name', async () => {
    const csv = await exportCsv();
    expect(csv).not.toContain('U23 EURO ROW');
    expect(csv).not.toContain('U23 Euro Checking');
    // -99.00 in a column of dollars is the shape of the defect, not just the row.
    expect(csv).not.toContain('-99.00');
  });

  it('the amount column sums to the register\'s figure: -$100.00 over 2 rows, not -$299.00 over 4', async () => {
    const csv = await exportCsv();
    const rows = dataRows(csv);
    expect(rows).toHaveLength(2);
    const sumCents = rows.reduce(
      (n, line) => n + Math.round(Number(line.split(',')[5]) * 100),
      0,
    );
    expect(sumCents).toBe(-10_000);
  });

  it('equals the register BY CONSTRUCTION — same rows, whatever the register decides they are', async () => {
    // The assertion that survives a future change to the register's basis: not "two rows",
    // but "the register's rows". A second copy of the clause could satisfy a hardcoded count
    // and still drift the day someone changes what the register shows.
    const csv = await exportCsv();
    const exported = dataRows(csv).map((l) => l.split(',')[2]).sort();
    const register = await getTransactions(USER);
    // `register.rows` is PAGE ONE (PAGE_SIZE 100), while the file is the whole ledger — so
    // the row-by-row comparison below is only the parity proof while the fixture fits on one
    // page. Asserted, not assumed: on a larger fixture this test must compare pages or totals
    // rather than quietly testing something narrower than it claims.
    expect(register.pageInfo.total).toBeLessThanOrEqual(register.pageInfo.pageSize);
    expect(register.pageInfo.total).toBe(exported.length);
    expect(register.rows.map((r) => r.rawDescriptor).sort()).toEqual(exported);
  });

  it('says so: the file names the withheld account and its currency', async () => {
    const csv = await exportCsv();
    // One euro account WITH rows — the brokerage-scope trap is the next test.
    expect(csv).toContain("Note: this file leaves out one account that isn't in U.S. dollars (EUR)");
    expect(csv).toContain('none of its transactions are in this file');
  });

  it('counts only accounts this FILE could have carried — a non-USD BROKERAGE is not its business', async () => {
    // A set carries the scope it was built for (the U.16 panels lesson, and the reason this
    // route reads account-scoped handover keys). Brokerage rows are out of this file for a
    // reason that has nothing to do with currency (#62), so announcing one as withheld FROM
    // THIS FILE would be a new false statement, not a disclosure.
    const brokerage = await prisma.account.create({
      data: {
        userId: USER, provider: 'simplefin', name: 'U23 Yen Brokerage',
        type: 'BROKERAGE', currentBalanceCents: 1_000, currency: 'JPY',
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: brokerage.id, date: '2026-07-05', amountCents: -1_000,
        rawDescriptor: 'U23 YEN ROW', status: 'POSTED',
        isTransfer: false, isSplitParent: false,
      },
    });
    try {
      const csv = await exportCsv();
      // Still ONE account withheld from this file, and JPY is not named in it.
      expect(csv).toContain("leaves out one account that isn't in U.S. dollars (EUR)");
      expect(csv).not.toContain('JPY');
      expect(csv).not.toContain('2 accounts');
      // The app-scoped banner legitimately says TWO for this same reader, and the file says
      // one — which is why the note's only app-wide sentence carries no number (see
      // regression__u23_totals_clause_states_a_rule_not_a_count).
      expect(await getWithheldAccountSummary(USER)).toEqual({
        count: 2,
        currencies: ['EUR', 'JPY'],
      });
    } finally {
      await prisma.transaction.deleteMany({ where: { accountId: brokerage.id } });
      await prisma.account.delete({ where: { id: brokerage.id } });
    }
  });

  it('an EMPTY non-USD account costs the file nothing, so the note does not claim it did', async () => {
    // The U.19 rule in the other direction: a note announcing missing rows where none exist
    // is the same false alarm. A reader with no rows withheld gets no note.
    await prisma.transaction.deleteMany({
      where: { account: { userId: USER, currency: 'EUR' } },
    });
    const csv = await exportCsv();
    expect(csv).not.toContain('Note: this file leaves out');
    // ...and the register-parity rows are untouched by the note's silence.
    expect(dataRows(csv)).toHaveLength(2);
  });
});
