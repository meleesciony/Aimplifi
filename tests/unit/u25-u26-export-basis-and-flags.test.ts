/**
 * U.25 + U.26 — the exported file states its basis, and carries the two flags that keep a row
 * out of every money total the app shows.
 *
 * Both were opened by the U.23 critics against the file U.23 had just made row-for-row equal to
 * the register.
 *
 * U.26 is the money half, and it was MEASURED: one $100.00 purchase, one $1,200.00 row the
 * reader had marked "not my spending", and one $2,000.00 transfer exported as three rows summing
 * -$3,300.00, while `summarizeTransactions` over those same three rows reported $100.00 of money
 * out and `excludedCount: 1`. Row-set parity was intact — this is not a U.23 regression. What the
 * file could not do was carry WHY two of its three rows are in no figure the app prints, so the
 * one act the file exists for, summing the amount column, produced a number 33 times the app's
 * with nothing in the file to explain it. The repro is rebuilt against a real database below.
 *
 * U.25 is the basis half: U.23 gave this file a note naming ONE of the four reasons it is
 * incomplete (the currency withhold) and gated it behind the rare condition of owning a non-USD
 * account, while the file's first line is its header — so for every other reader the file stated
 * its basis nowhere, and a lone enumerated omission reads as the complete list.
 *
 * Doctrine, inherited from U.19 and U.23 on this same file: every test guards a CLAIM. The
 * disclosure cases assert what each note may and may not say; the money case asserts the file
 * against the register's own summary rather than against a hardcoded figure a second copy of the
 * rule could satisfy while drifting.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));

import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { GET } from '@/app/api/export/route';
import { prisma } from '@/lib/db';
import { getTransactions } from '@/server/transactions';
import { summarizeTransactions } from '@/lib/engine/transactions/query';
import { excludedTransferCsvNote, transactionsToCsv, type ExportTxn } from '@/lib/export';

const NONE_WITHHELD = { count: 0, currencies: [] };

const csvRow = (over: Partial<ExportTxn> = {}): ExportTxn => ({
  date: '2026-07-10',
  account: 'Checking',
  rawDescriptor: 'COSTCO WHSE #0482',
  merchant: 'Costco',
  category: 'Groceries',
  amountCents: -8_412,
  status: 'POSTED',
  onHandoverDay: false,
  excludeFromTotals: false,
  isTransfer: false,
  ...over,
});

// ─── U.25: the basis note ────────────────────────────────────────────────────

describe('U.25 — every file states its basis', () => {
  it('is UNCONDITIONAL: the plainest possible reader still gets it', () => {
    // The fact it states is true of every file, so it is gated on nothing. Bolting it onto
    // the currency note — the obvious cheaper move — would have gated a truth about every
    // reader behind owning a euro account, which is the defect
    // `a-disclosure-gated-to-the-loudest-branch-misses-the-reachable-one` distilled one
    // session earlier.
    const out = transactionsToCsv([csvRow()], NONE_WITHHELD);
    expect(out).toContain('Note: this file lists transactions from your spending accounts');
  });

  it('is there even when the file has no rows at all', () => {
    // An empty export is the one file where a reader is MOST likely to conclude something is
    // broken, and the basis is the answer: their accounts may all be types this file cannot
    // carry. A note gated on `rows.length` would go silent exactly there.
    const out = transactionsToCsv([], NONE_WITHHELD);
    expect(out).toContain('Note: this file lists transactions');
  });

  it('states a RULE, and never a list of the things it leaves out', () => {
    // An enumeration is a promise of completeness. There are four reasons a row is missing
    // (account type, split parents, the reconciliation keep, currency) and naming any subset
    // reads as the whole set — then goes stale the next time the register's basis moves.
    // `closing-a-gap-shrinks-the-disclosure-that-described-it`.
    const out = transactionsToCsv([csvRow()], NONE_WITHHELD);
    expect(out).not.toMatch(/mortgage|brokerage|investment|loan/i);
    expect(out).not.toMatch(/split/i);
    expect(out).toContain('the same rows Aimplifi shows on its Transactions page');
  });

  it('regression__u25_basis_note_asserts_nothing_about_the_readers_own_data', () => {
    // BOTH critic passes executed this independently. The first draft closed with "It does
    // not cover every account you hold, and it is not every transaction row Aimplifi has
    // stored" — measured FALSE at 2 accounts of 2 and 3 rows of 3 for a reader holding only
    // spending accounts, and false for the production demo's own file, where all 847 stored
    // rows export. An unconditional sentence may state a rule about the FILE; the moment it
    // asserts something about the reader's holdings it has to be gated on their holdings,
    // and this note is gated on nothing.
    const out = transactionsToCsv([csvRow()], NONE_WITHHELD);
    expect(out).not.toContain('does not cover every account you hold');
    expect(out).not.toContain('not every transaction row Aimplifi has stored');
    // The rule form, which is true whether or not the reader owns such an account.
    expect(out).toContain('Accounts of any other kind are not represented here, whether or not you hold one');
  });

  it('glosses the account types, for the reader who cannot open the app', () => {
    // The file may be forwarded to an accountant, who has no Transactions page to open —
    // `a-disclosure-written-for-a-page-is-false-in-an-email`. The one clause they can act on
    // must not be app jargon; the gloss is the register page's own.
    const out = transactionsToCsv([csvRow()], NONE_WITHHELD);
    expect(out).toContain('checking, savings and credit cards');
  });

  it('scopes the equality clause to the reader\'s own rows, and to every page', () => {
    // The Transactions page also renders a household member's SHARED rows, ungated by
    // filters (transactions/page.tsx:270), and paginates at 100 while the file does not. So
    // "the same rows the Transactions page lists" — the first draft — was false for a
    // household member and confusing for anyone with more than 100 rows.
    const out = transactionsToCsv([csvRow()], NONE_WITHHELD);
    expect(out).toContain('Within those accounts');
    expect(out).toContain('across every page of it');
  });

  it('rides the file as a rectangular row, first among the notes', () => {
    const out = transactionsToCsv([csvRow()], NONE_WITHHELD);
    const lines = out.split('\r\n');
    expect(lines[2].startsWith('"Note: this file lists')).toBe(true);
    expect(lines[2].endsWith(',,,,,,,,,')).toBe(true);
  });
});

// ─── U.26: the two columns and the note that reads them ──────────────────────

describe('U.26 — the columns', () => {
  it('appends rather than inserting: `amount` is still field 5 for a reader\'s saved script', () => {
    // The two new columns read more naturally beside `amount`. They are at the end anyway,
    // because a reader's spreadsheet or script indexes this file by POSITION, and inserting
    // a column mid-row silently re-points every one of those indexes at the wrong field.
    const out = transactionsToCsv([csvRow({ amountCents: -8_412 })], NONE_WITHHELD);
    const [header, row] = out.split('\r\n');
    expect(header.split(',')[5]).toBe('amount');
    expect(row.split(',')[5]).toBe('-84.12');
    expect(header.split(',').slice(-2)).toEqual(['excluded_from_totals', 'transfer']);
  });

  it('is UNCONDITIONAL, like `changeover_day`: one schema for every reader', () => {
    // A column that appears only for readers who have excluded a row is a file whose shape
    // depends on who exported it — anything automated against it breaks silently, and only
    // for some of them.
    const plain = transactionsToCsv([csvRow()], NONE_WITHHELD).split('\r\n');
    const flagged = transactionsToCsv([csvRow({ excludeFromTotals: true })], NONE_WITHHELD).split('\r\n');
    expect(plain[0]).toBe(flagged[0]);
    expect(plain[1].split(',')).toHaveLength(10);
    expect(flagged[1].split(',')).toHaveLength(10);
  });

  it('marks each flag independently, and a row can carry both', () => {
    const rows = [
      csvRow({ rawDescriptor: 'PLAIN' }),
      csvRow({ rawDescriptor: 'EXCLUDED', excludeFromTotals: true }),
      csvRow({ rawDescriptor: 'TRANSFER', isTransfer: true }),
      csvRow({ rawDescriptor: 'BOTH', excludeFromTotals: true, isTransfer: true }),
    ];
    const lines = transactionsToCsv(rows, NONE_WITHHELD).split('\r\n');
    expect(lines[1].endsWith(',,,')).toBe(true); // changeover, excluded, transfer all empty
    expect(lines[2].endsWith(',,yes,')).toBe(true);
    expect(lines[3].endsWith(',,,yes')).toBe(true);
    expect(lines[4].endsWith(',,yes,yes')).toBe(true);
  });
});

describe('U.26 — the note', () => {
  it('is silent when the file holds no flagged row', () => {
    // Telling a reader who has never excluded a row what the column means sends them down a
    // column of blanks looking for a marker that was never there.
    expect(excludedTransferCsvNote([csvRow()])).toBeNull();
    expect(transactionsToCsv([csvRow()], NONE_WITHHELD)).not.toContain('excluded_from_totals are ones');
  });

  it('names only the flag that is actually present', () => {
    const excluded = excludedTransferCsvNote([csvRow({ excludeFromTotals: true })]) ?? '';
    expect(excluded).toContain('excluded_from_totals');
    expect(excluded).not.toContain('rows marked yes in transfer');

    const transfer = excludedTransferCsvNote([csvRow({ isTransfer: true })]) ?? '';
    expect(transfer).toContain('rows marked yes in transfer');
    expect(transfer).not.toContain('excluded_from_totals');
  });

  it('says both when both are present, and agrees with itself on number', () => {
    const both = excludedTransferCsvNote([
      csvRow({ excludeFromTotals: true }),
      csvRow({ isTransfer: true }),
    ]) ?? '';
    expect(both).toContain('excluded_from_totals');
    // Case-insensitive: the transfer sentence is capitalised when it follows the excluded
    // one and lowercase when it opens the note.
    expect(both).toMatch(/rows marked yes in transfer/i);
    expect(both).toContain('Both kinds are left out of');
    const one = excludedTransferCsvNote([csvRow({ isTransfer: true })]) ?? '';
    expect(one).toContain('They are left out of');
    expect(one).not.toContain('Both kinds');
    expect(one.startsWith('Note: rows marked yes in transfer')).toBe(true);
  });

  it('regression__u26_note_states_no_direction', () => {
    // The flagged rows carry SIGNED amounts, so "your sum will be too high" is false for a
    // reader whose excluded rows are refunds — the same inverted-direction clause the
    // U.19–U.22 critic caught executing backwards on negative-net merchants. "Includes money
    // those totals leave out" is true whatever the signs are, and true even when they cancel.
    for (const rows of [
      [csvRow({ excludeFromTotals: true, amountCents: -120_000 })],
      [csvRow({ excludeFromTotals: true, amountCents: 120_000 })],
      [csvRow({ isTransfer: true, amountCents: -200_000 }), csvRow({ isTransfer: true, amountCents: 200_000 })],
    ]) {
      const note = excludedTransferCsvNote(rows) ?? '';
      expect(note).not.toMatch(/higher|larger|too high|more than|overstate|understate|bigger|smaller/i);
      expect(note).toContain('includes money those three figures leave out');
    }
  });

  it('regression__u26_note_promises_no_equality', () => {
    // It does not tell the reader that dropping these rows reproduces the app's figures.
    // `changeover_day` can still double a row in the same file, and a claim that two engines
    // agree is exactly what `a-link-on-a-figure-asserts-two-engines-agree` says must be
    // earned rather than asserted. The file states the fact; the arithmetic stays the reader's.
    const note = excludedTransferCsvNote([csvRow({ excludeFromTotals: true, isTransfer: true })]) ?? '';
    // Not a bare /match/: the transfer sentence legitimately says "the matching row on the
    // other account", which is a claim about a ROW, not about two engines agreeing.
    expect(note).not.toMatch(/matches |match the |reproduce|equals |will agree|same figure/i);
  });

  it('regression__u26_totals_claim_names_the_three_tiles_it_can_prove', () => {
    // The first draft said these rows are left out of "the spending, income and net totals it
    // shows" — app-wide, and FALSE. The money critic executed the counterexample on the
    // production demo: an auto-loan ACH carries `isTransfer`, `recurring/detect.ts:416`
    // deliberately keeps it, and /spending-plan prints "CarMax Auto Finance $385.00/mo" inside
    // a $3,096.72 Fixed figure — 18 rows this file marks `transfer,yes`. The excluded side has
    // the same shape: the tax export keeps a row the reader both tagged and excluded.
    // `summarizeTransactions` is the ONLY basis these two flags gate, so the sentence names
    // its three figures and nothing wider.
    const note = excludedTransferCsvNote([csvRow({ excludeFromTotals: true, isTransfer: true })]) ?? '';
    expect(note).not.toMatch(/every (figure|total|number)/i);
    expect(note).not.toContain('the spending, income and net totals it shows');
    expect(note).toContain('the money-in, money-out and net figures on Aimplifi\'s Transactions page');
  });

  it('regression__u26_note_claims_no_balance_behavior', () => {
    // The first draft closed "Account balances count every row either way", which is false for
    // a hand-entered row: `transactions/manual.ts:7` records that a manual entry never
    // rewrites a provider-authoritative balance, and the register invites hand entry. The
    // reassurance the clause existed to give — the money is not fictional — survives without
    // naming a figure the file cannot vouch for.
    const note = excludedTransferCsvNote([csvRow({ excludeFromTotals: true, isTransfer: true })]) ?? '';
    expect(note).not.toMatch(/account balances/i);
    expect(note).toContain('The rows are still real transactions');
    expect(note).toContain('other parts of Aimplifi may count them');
  });

  it('regression__u26_transfer_clause_asserts_no_counterpart_and_no_ownership', () => {
    // `isTransfer` is set by descriptor evidence alone — `transfers.ts:139` turns the
    // `auto-loan` merchant category into transfer evidence — so a reader who never added
    // their car loan owns no second account for the money to have moved to. The first draft
    // told them the matching row existed somewhere and that they owned both ends. Both are
    // the app's JUDGEMENT about a row, so the sentence attributes it to the app.
    const note = excludedTransferCsvNote([csvRow({ isTransfer: true })]) ?? '';
    expect(note).not.toContain('accounts you own');
    expect(note).not.toContain('matching row');
    expect(note).toContain('ones Aimplifi treated as moving money between accounts');
  });

  it('regression__u26_excluded_clause_is_sign_neutral_and_uses_the_controls_own_label', () => {
    // Excluding is not gated on sign (`actions.ts:363-386`) and `summarizeTransactions` drops
    // the row from INFLOW too (`query.ts:419`, before the `> 0` branch), so "you told us this
    // was not your spending" is wrong about an excluded refund. The app's control says
    // "Exclude from totals" — the badge, the menu item — so the file says that.
    const note = excludedTransferCsvNote([csvRow({ excludeFromTotals: true, amountCents: 120_000 })]) ?? '';
    expect(note).not.toMatch(/not your spending/i);
    expect(note).toContain('ones you marked "Exclude from totals" in Aimplifi');
  });
});

// ─── the measured case, against a real database ──────────────────────────────

describe('U.26 — the critic\'s measurement, rebuilt', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `u26-${stamp}`;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.rateLimit.deleteMany({ where: { key: `export:${USER}` } });
  }

  beforeAll(async () => {
    await wipe().catch(() => {});
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: USER, provider: 'simplefin', name: 'U26 Checking',
        type: 'CHECKING', currentBalanceCents: 500_000, currency: 'USD',
      },
    });
    // The mortgage the transfer pays: a real account, and one this file cannot carry (#62),
    // which is why the transfer's offsetting leg is invisible here.
    await prisma.account.create({
      data: {
        userId: USER, provider: 'simplefin', name: 'U26 Mortgage',
        type: 'MORTGAGE', currentBalanceCents: 30_000_000, currency: 'USD',
      },
    });
    for (const [descriptor, amountCents, flags] of [
      ['U26 GROCERY PURCHASE', -10_000, {}],
      ['U26 REIMBURSED WORK LAPTOP', -120_000, { excludeFromTotals: true }],
      ['U26 MORTGAGE PAYMENT', -200_000, { isTransfer: true }],
    ] as const) {
      await prisma.transaction.create({
        data: {
          accountId: checking.id, date: '2026-07-05', amountCents,
          rawDescriptor: descriptor, status: 'POSTED', isSplitParent: false,
          isTransfer: false, ...flags,
        },
      });
    }
  });
  afterAll(wipe);

  async function exportCsv(): Promise<string> {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    // The route's durable limit is 10 exports per 60s; cleared per call so the count can
    // never be the reason a future case in this block goes red.
    await prisma.rateLimit.deleteMany({ where: { key: `export:${USER}` } });
    const res = await GET(new NextRequest('http://localhost/api/export?format=transactions-csv'));
    expect(res.status).toBe(200);
    return res.text();
  }

  const dataRows = (csv: string) =>
    csv.split('\r\n').slice(1).filter((l) => l.length > 0 && !l.startsWith('"Note:'));
  /** Fields read from the END — see the comment in the first case below. */
  const amountCentsOf = (line: string) => {
    const f = line.split(',');
    return Math.round(Number(f[f.length - 5]) * 100);
  };
  const flagsOf = (line: string) => {
    const f = line.split(',');
    return { excluded: f[f.length - 2] === 'yes', transfer: f[f.length - 1] === 'yes' };
  };

  it('the fixture reproduces the measurement: 3 rows summing -$3,300.00 against $100.00 out', async () => {
    // Without this the assertions below could pass against an empty database, and — more to
    // the point — this IS the defect, restated as an executable measurement. The gap is real
    // and stays real: the file's job is to explain it, not to close it.
    const rows = dataRows(await exportCsv());
    expect(rows).toHaveLength(3);
    // `amount` read as the FIFTH field from the END, never the sixth from the start: the
    // account, description, merchant and category fields may be quoted and may contain
    // commas, and nothing after `amount` ever can. The live check and the e2e read it the
    // same way; this file used to be the one place that did not.
    const summed = rows.reduce((n, line) => n + amountCentsOf(line), 0);
    expect(summed).toBe(-330_000);

    // The register's OWN summary — the object the page prints its tiles from, not a
    // recomputation that could agree with the file while the page disagreed with both.
    const register = await getTransactions(USER);
    expect(register.summary.count).toBe(3);
    expect(register.summary.outflowCents).toBe(10_000);
    expect(register.summary.excludedCount).toBe(1);
    // ...and it is the shared engine that produced it. `rows` is the PAGE slice while
    // `summary` is computed over the whole filtered set, so this equality is a proof only
    // while the fixture fits on one page — it does, at three rows, and the count assertion
    // above is what would notice if that ever stopped being true.
    expect(summarizeTransactions(register.rows)).toEqual(register.summary);
  });

  it('every row the register keeps out of its totals is marked in the file', async () => {
    // The claim this slice adds, asserted BY CONSTRUCTION against the register rather than
    // against the fixture's hardcoded shape: whatever `summarizeTransactions` declines to
    // sum, the file says so on that row.
    const csv = await exportCsv();
    const marked = new Map(
      dataRows(csv).map((line) => {
        const { excluded, transfer } = flagsOf(line);
        // The descriptor is field 3 forward; safe here because this fixture writes no comma
        // into one, and the assertion below would fail loudly rather than quietly if it did.
        return [line.split(',')[2].replace(/^"|"$/g, ''), excluded || transfer];
      }),
    );
    const register = await getTransactions(USER);
    expect(register.rows).toHaveLength(3);
    for (const t of register.rows) {
      const countedByTheApp = !t.isTransfer && !t.excludeFromTotals;
      expect(marked.get(t.rawDescriptor)).toBe(!countedByTheApp);
    }
    expect([...marked.values()].filter(Boolean)).toHaveLength(2);
  });

  it('and the file says what the marks mean, in both note shapes at once', async () => {
    const csv = await exportCsv();
    expect(csv).toContain('Note: this file lists transactions from your spending accounts');
    expect(csv).toContain('rows marked yes in excluded_from_totals');
    expect(csv).toMatch(/rows marked yes in transfer/i);
    expect(csv).toContain('Both kinds are left out of');
    // The currency guard kept nothing out of this reader's file, so it is not mentioned.
    expect(csv).not.toContain('leaves out');
  });
});
