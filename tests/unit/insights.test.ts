/**
 * Phase 3 insights on REAL seed data: monthly savings rate (3 hand-verified
 * months), opportunity ranking, lifestyle creep, runway, life energy, and the
 * Money Review narrative.
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import {
  creepPanelBasis,
  detectLifestyleCreep,
  findOpportunities,
  hoursOfWork,
  countsInFlows,
  isIncomeFlowRow,
  monthlyFlows,
  monthsOfRunway,
  runwayTitle,
} from '@/lib/engine/fi/insights';
import { isSpendRow } from '@/lib/engine/reports/reports';
import { generateMoneyReview } from '@/lib/engine/fi/coach-copy';
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { detectTransfers } from '@/lib/engine/categorize/transfers';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES, overrideKey } from '@/lib/engine/recurring/override';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

const seed = buildSeedData('2026-06-10');
const flows = monthlyFlows(seed.transactions);
const series = detectRecurring(
  seed.transactions.filter((t) => t.status === 'POSTED'),
  isoDate('2026-06-10'),
  NO_RECURRING_OVERRIDES,
);

function txn(over: {
  rawDescriptor: string;
  amountCents: number;
  isTransfer?: boolean;
}): Parameters<typeof categorize>[0] {
  return {
    date: '2026-07-06',
    accountId: 'checking',
    isTransfer: false,
    ...over,
  };
}

describe('monthly savings rate from seed data (3 hand-verified months)', () => {
  // Hand math: income is payroll (+$2,450 biweekly Fridays anchored 2026-06-12)
  // plus, since #251, the engineered side-gig payout (+$380.00 monthly on the 10th,
  // 2026-01-10..2026-04-10 — the Income-Pause Radar seed). Months with exactly two
  // paydays AND one payout → income = 2×245000 + 38000 = 528000 = $5,280.00:
  //   2026-01 (Fri 01-09, 01-23 + payout 01-10),
  //   2026-03 (03-06, 03-20 + payout 03-10),
  //   2026-04 (04-03, 04-17 + payout 04-10).
  // Transfers (savings, card payments, loan ACH) are excluded from both sides.
  it.each(['2026-01', '2026-03', '2026-04'])('%s: income is exactly $5,280.00', (month) => {
    const m = flows.find((f) => f.month === month)!;
    expect(m.incomeCents).toBe(528_000);
  });

  it('rate = (income − expenses)/income, cross-checked by independent re-aggregation', () => {
    for (const month of ['2026-01', '2026-03', '2026-04']) {
      const m = flows.find((f) => f.month === month)!;
      // independent aggregation path (no engine code)
      const txns = seed.transactions.filter(
        (t) => t.date.startsWith(month) && !t.isTransfer && t.status === 'POSTED',
      );
      const income = txns.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
      const expenses = txns.filter((t) => t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0);
      expect(m.incomeCents).toBe(income);
      expect(m.expensesCents).toBe(expenses);
      expect(m.savingsRateBps).toBe(Math.round(((income - expenses) / income) * 10000));
    }
  });

  it('a $500 own-account transfer changes neither income nor expenses (EDGE_CASES §FI)', () => {
    const withTransfer = monthlyFlows([
      { date: '2026-03-02', amountCents: 600000, rawDescriptor: 'PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED' },
      { date: '2026-03-10', amountCents: -420000, rawDescriptor: 'RENT', accountId: 'a', isTransfer: false, status: 'POSTED' },
      { date: '2026-03-15', amountCents: -50000, rawDescriptor: 'TRANSFER TO SAVINGS', accountId: 'a', isTransfer: true, status: 'POSTED' },
    ]);
    expect(withTransfer[0].savingsRateBps).toBe(3000); // still exactly 30.00%
  });

  it('test_regression__o20j_transfer_category_unflagged_does_not_count_in_flows', () => {
    // O.20j / DECISIONS #446: live corpus had 76 rows with categoryId=transfer
    // and isTransfer=false. isSpendRow already dropped the leaf; countsInFlows
    // did not, so /reports chart bars, /coach savings rate + Money Review, and
    // Ask income/expense answers all moved. Lock the shared predicate AND the
    // monthlyFlows surface those pages read.
    const base = [
      {
        date: '2026-07-01',
        amountCents: 600_000,
        rawDescriptor: 'PAYROLL',
        accountId: 'a',
        isTransfer: false,
        status: 'POSTED',
        categoryId: 'paycheck',
      },
      {
        date: '2026-07-05',
        amountCents: -40_000,
        rawDescriptor: 'KROGER',
        accountId: 'a',
        isTransfer: false,
        status: 'POSTED',
        categoryId: 'groceries',
      },
    ] as const;
    const leakOut = {
      date: '2026-07-06',
      amountCents: -1_005_127, // $10,051.27 — measured single-month ceiling in TASKS
      rawDescriptor: 'Funds Transfer to Brokerage',
      accountId: 'a',
      isTransfer: false,
      status: 'POSTED',
      categoryId: 'transfer',
    };
    const leakIn = {
      date: '2026-07-07',
      amountCents: 779_297, // counterpart-shaped inflow also filed as Transfer
      rawDescriptor: 'Overdraft Transfer from Brokerage -7383',
      accountId: 'a',
      isTransfer: false,
      status: 'POSTED',
      categoryId: 'transfer',
    };

    expect(countsInFlows(leakOut)).toBe(false);
    expect(countsInFlows(leakIn)).toBe(false);
    expect(isIncomeFlowRow(leakIn)).toBe(false);
    // Parity with the spend card: the same leaf is already refused there.
    expect(
      isSpendRow(leakOut, { fromYm: '2026-07', toYm: '2026-07' }),
    ).toBe(false);

    const without = monthlyFlows([...base]);
    const withLeak = monthlyFlows([...base, leakOut, leakIn]);
    expect(withLeak).toEqual(without);
    expect(withLeak[0].incomeCents).toBe(600_000);
    expect(withLeak[0].expensesCents).toBe(40_000);
    // Fail-old shape: if the category gate is deleted, expenses jump by the
    // outflow and the inflow nets spend down — income stays put (transfer is
    // not an Income-group leaf), so the savings rate moves.
    expect(withLeak[0].savingsRateBps).toBe(without[0].savingsRateBps);
  });

  it('test_regression__o20j_r6_overdraft_transfer_from_brokerage_is_not_fees_spend', () => {
    // O.20j R6 / DECISIONS #486: eight live "Overdraft Transfer from Brokerage
    // -7383" rows on 2026-07-06; seven were pair-flagged isTransfer, the
    // largest ($7,792.97) was not and sat in Fees & Charges — so the #485
    // transfer-leaf gate still counted it as spend. Root cause: GENERIC
    // `\bOVERDRAFT\b` → fees beat any transfer rule. Lock the category path
    // AND the shared spend predicates on the documented descriptor/amount.
    const DESCRIPTOR = 'Overdraft Transfer from Brokerage -7383';
    const AMOUNT = -779_297; // $7,792.97

    const filed = categorize(
      txn({ rawDescriptor: DESCRIPTOR, amountCents: AMOUNT, isTransfer: false }),
    );
    expect(filed.categoryId).toBe('transfer');
    expect(filed.source).toBe('transfer');
    expect(filed.needsReview).toBe(false);

    // Real bank fee must still auto-file to Fees & Charges.
    const realFee = categorize(
      txn({ rawDescriptor: 'OVERDRAFT FEE', amountCents: -3_500, isTransfer: false }),
    );
    expect(realFee.categoryId).toBe('fees');

    // Descriptor evidence alone (no opposite leg) detects the transfer —
    // the live miss was the unpaired largest amount.
    expect(
      detectTransfers([
        {
          id: 'large',
          accountId: 'checking',
          date: '2026-07-06',
          amountCents: AMOUNT,
          rawDescriptor: DESCRIPTOR,
          isSplitParent: false,
        },
      ]),
    ).toEqual(new Set(['large']));

    const row = {
      id: 'large',
      date: '2026-07-06',
      amountCents: AMOUNT,
      rawDescriptor: DESCRIPTOR,
      accountId: 'checking',
      isTransfer: false,
      status: 'POSTED' as const,
      categoryId: filed.categoryId,
    };
    expect(countsInFlows(row)).toBe(false);
    expect(isSpendRow(row, { fromYm: '2026-07', toYm: '2026-07' })).toBe(false);

    const base = [
      {
        date: '2026-07-01',
        amountCents: 600_000,
        rawDescriptor: 'PAYROLL',
        accountId: 'a',
        isTransfer: false,
        status: 'POSTED',
        categoryId: 'paycheck',
      },
      {
        date: '2026-07-05',
        amountCents: -40_000,
        rawDescriptor: 'KROGER',
        accountId: 'a',
        isTransfer: false,
        status: 'POSTED',
        categoryId: 'groceries',
      },
    ] as const;
    const without = monthlyFlows([...base]);
    const withLeak = monthlyFlows([...base, row]);
    expect(withLeak).toEqual(without);
    expect(withLeak[0].expensesCents).toBe(40_000);
  });
});

describe('refund netting (ROADMAP #4): a return reduces spend, not inflates income', () => {
  it('$450 purchase + $100 return in shopping → $350 net spend, NOT counted as income', () => {
    // income 200000; expenses 45000 − 10000 = 35000; rate = (200000−35000)/200000 = 82.50%.
    const f = monthlyFlows([
      { date: '2026-03-01', amountCents: 200000, rawDescriptor: 'PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'income' },
      { date: '2026-03-05', amountCents: -45000, rawDescriptor: 'AMZN', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
      { date: '2026-03-12', amountCents: 10000, rawDescriptor: 'AMZN REFUND', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
    ])[0];
    expect(f.incomeCents).toBe(200000);
    expect(f.expensesCents).toBe(35000);
    expect(f.savingsRateBps).toBe(8250);
  });

  it('a positive in the income category still counts as income (not netted)', () => {
    const f = monthlyFlows([
      { date: '2026-03-01', amountCents: 100000, rawDescriptor: 'PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'income' },
      { date: '2026-03-05', amountCents: -40000, rawDescriptor: 'KROGER', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'groceries' },
    ])[0];
    expect(f.incomeCents).toBe(100000);
    expect(f.expensesCents).toBe(40000);
  });

  it('a positive with no/unknown category stays income (ambiguous inflow not netted)', () => {
    const f = monthlyFlows([
      { date: '2026-03-01', amountCents: 50000, rawDescriptor: 'UNKNOWN DEPOSIT', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: null },
      { date: '2026-03-05', amountCents: -20000, rawDescriptor: 'STORE', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
    ])[0];
    expect(f.incomeCents).toBe(50000);
    expect(f.expensesCents).toBe(20000);
  });

  it('refunds never drive a month’s spend below $0 (floored)', () => {
    const f = monthlyFlows([
      { date: '2026-03-05', amountCents: -5000, rawDescriptor: 'STORE', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
      { date: '2026-03-06', amountCents: 20000, rawDescriptor: 'BIG REFUND', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
    ])[0];
    expect(f.expensesCents).toBe(0);
    expect(f.incomeCents).toBe(0);
  });
});

describe('test_regression__monthly-flows-income-leaves: Income-GROUP leaves count as income', () => {
  // REGRESSION (2026-07-05): monthlyFlows keyed on the LITERAL id 'income', which
  // predates the #163 leaf taxonomy. A real user's payroll descriptor (PAYROLL /
  // DIRECT DEP / GUSTO / ADP…) categorizes as 'paycheck' (normalize.ts income
  // rules), so their SALARY was netted against expenses as a "refund": income $0,
  // expenses absurdly low, savings rate + FI + coach all garbage. The demo seed
  // dodged it via its merchant-specific rule (ACME → 'income'), which is why every
  // golden stayed green while production was wrong.
  it("a 'paycheck' salary counts as income, not a refund (income $3,000 / spend $400 / rate 86.67%)", () => {
    const f = monthlyFlows([
      { date: '2026-03-01', amountCents: 300000, rawDescriptor: 'ACH DIRECT DEP GUSTO', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'paycheck' },
      { date: '2026-03-05', amountCents: -40000, rawDescriptor: 'KROGER', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'groceries' },
    ])[0];
    expect(f.incomeCents).toBe(300000);
    expect(f.expensesCents).toBe(40000);
    // (300000 − 40000) / 300000 = 86.666…% → 8667 bps (banker-free round half away from zero)
    expect(f.savingsRateBps).toBe(8667);
  });

  it('EVERY Income-group leaf in the taxonomy counts a positive as income (canary for future leaves)', () => {
    // 'refund' is the one deliberate exception: a manually-filed "Refund" is a
    // merchandise return and NETS against spend (ROADMAP #4; #166 critic F1 —
    // counting it as income inflated income AND expenses vs the same return
    // filed to its purchase category).
    for (const c of CATEGORIES.filter((c) => c.group === 'Income' && c.id !== 'refund')) {
      const f = monthlyFlows([
        { date: '2026-03-01', amountCents: 12345, rawDescriptor: 'X', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: c.id },
      ])[0];
      expect(f.incomeCents, `leaf '${c.id}' must classify as income`).toBe(12345);
      expect(f.expensesCents, `leaf '${c.id}' must not net against spend`).toBe(0);
    }
  });

  it("the 'refund' leaf NETS against spend — a store return filed as Refund is not income (#166 F1)", () => {
    const f = monthlyFlows([
      { date: '2026-03-01', amountCents: 300000, rawDescriptor: 'PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'paycheck' },
      { date: '2026-03-05', amountCents: -50000, rawDescriptor: 'TV STORE', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'electronics' },
      { date: '2026-03-12', amountCents: 10000, rawDescriptor: 'TV RETURN', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'refund' },
    ])[0];
    // Same figures as filing the return to 'electronics': income 3000, spend 400.
    expect(f.incomeCents).toBe(300000);
    expect(f.expensesCents).toBe(40000);
  });

  it('a positive in a NON-income category is still netted as a refund (behavior preserved)', () => {
    const f = monthlyFlows([
      { date: '2026-03-05', amountCents: -45000, rawDescriptor: 'AMZN', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
      { date: '2026-03-12', amountCents: 10000, rawDescriptor: 'AMZN REFUND', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
    ])[0];
    expect(f.incomeCents).toBe(0);
    expect(f.expensesCents).toBe(35000);
  });

  it('a positive in a CUSTOM category (unknown id) is netted, not income (custom = spending by definition)', () => {
    const f = monthlyFlows([
      { date: '2026-03-05', amountCents: -30000, rawDescriptor: 'GOLF SHOP', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'cl_custom123' },
      { date: '2026-03-12', amountCents: 5000, rawDescriptor: 'GOLF SHOP REFUND', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'cl_custom123' },
    ])[0];
    expect(f.incomeCents).toBe(0);
    expect(f.expensesCents).toBe(25000);
  });
});

describe('savings opportunities ranked by compounded impact', () => {
  const opportunities = findOpportunities(series, 700, 250, []);

  it('finds the unused gym, the Netflix increase, insurance re-shop, negotiable internet', () => {
    const kinds = opportunities.map((o) => o.kind);
    expect(kinds).toContain('unused-subscription');
    expect(kinds).toContain('price-increase');
    expect(kinds).toContain('insurance-reshop');
    expect(kinds).toContain('negotiable-bill');
  });

  // W.10 renamed the sort key: it is the 30-year value in TODAY'S money now, not a future
  // value. The ORDER is unchanged — the annuity is linear in the monthly amount and every row
  // shares one rate pair — which is what this asserts.
  it('ranks by the 30-year today\'s-money value, descending (gym $34.99 first)', () => {
    expect(opportunities[0].kind).toBe('unused-subscription');
    expect(opportunities[0].merchant).toBe('LA Fitness');
    expect(opportunities[0].monthlyCents).toBe(3499);
    const fvs = opportunities.map((o) => o.todayValue30Cents);
    expect([...fvs].sort((a, b) => b - a)).toEqual(fvs);
  });

  it('Netflix price increase contributes the $2.50 delta, not the full price', () => {
    const netflix = opportunities.find((o) => o.kind === 'price-increase')!;
    expect(netflix.merchant).toBe('Netflix');
    expect(netflix.monthlyCents).toBe(250);
  });

  it('price-increase opportunities carry their transition + change date (value-receipt anchors, #206); other kinds do not', () => {
    const netflix = opportunities.find((o) => o.kind === 'price-increase')!;
    expect(netflix.priceFromCents).toBe(1549);
    expect(netflix.priceToCents).toBe(1799);
    expect(netflix.priceChangedAt).toBe('2026-02-03');
    for (const o of opportunities.filter((x) => x.kind !== 'price-increase')) {
      expect(o.priceFromCents).toBeUndefined();
      expect(o.priceChangedAt).toBeUndefined();
    }
  });

  it('estimates are labeled as estimates', () => {
    expect(opportunities.find((o) => o.kind === 'insurance-reshop')!.isEstimate).toBe(true);
    expect(opportunities.find((o) => o.kind === 'unused-subscription')!.isEstimate).toBe(false);
  });

  it('test_regression__w6a_opportunities_skip_money_dial_categories', () => {
    // Demo Settings dials are travel/dining — neither is a seed opportunity
    // category, so the ranking is byte-identical to the empty-dial list.
    const demoDials = findOpportunities(series, 700, 250, ['travel', 'dining']);
    expect(demoDials.map((o) => `${o.kind}:${o.merchant}:${o.monthlyCents}`)).toEqual(
      opportunities.map((o) => `${o.kind}:${o.merchant}:${o.monthlyCents}`),
    );
    // Fitness IS the unused-gym category. A reader who set it as a money dial
    // is spending there on purpose — do not rank the gym as a cut.
    const protectedGym = findOpportunities(series, 700, 250, ['fitness']);
    expect(protectedGym.some((o) => o.merchant === 'LA Fitness')).toBe(false);
    expect(protectedGym.some((o) => o.kind === 'price-increase' && o.merchant === 'Netflix')).toBe(
      true,
    );
  });
});

describe('lifestyle-creep detector on the engineered seed rise', () => {
  // The pure seed's rows arrive UNCATEGORIZED (categoryId null — categories are
  // applied at ingest, prisma/seed.ts Phase 2). The register-parity rule (O.20h
  // critic P1-1) counts by the STORED label, so this lock mirrors the shipped
  // ingest step — categorize every row exactly as seed.ts writes it — before
  // running the engine. Running it on the raw nulls would measure an empty bar
  // and prove nothing about the demo.
  const seedTxns = seed.transactions.map((t) => ({
    ...t,
    categoryId: categorize({
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountId: t.accountId,
      isTransfer: t.isTransfer,
    }).categoryId,
  }));
  it('flags the final-6-months discretionary rise against flat income', () => {
    const creep = detectLifestyleCreep(seedTxns, isoDate('2026-06-10'));
    expect(creep.flagged).toBe(true);
    expect(creep.spendGrowthBps).toBeGreaterThan(creep.incomeGrowthBps + 500);
    expect(creep.monthlyDiscretionaryCents).toHaveLength(6);
  });
  it('does NOT flag a flat-spend household (fixture)', () => {
    const flat = Array.from({ length: 8 }, (_, k) => [
      { date: `2025-${String(k + 1).padStart(2, '0')}-05`, amountCents: 490000, rawDescriptor: 'ACH DEPOSIT ACME ANALYTICS PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED' as const },
      { date: `2025-${String(k + 1).padStart(2, '0')}-10`, amountCents: -30000, rawDescriptor: 'STARBUCKS 800-782-7282', accountId: 'a', isTransfer: false, status: 'POSTED' as const },
    ]).flat();
    const creep = detectLifestyleCreep(flat, isoDate('2025-09-01'));
    expect(creep.flagged).toBe(false);
  });
});

describe('creep bars carry their rows out of the summing loop (O.20d)', () => {
  const txn = (
    date: string,
    amountCents: number,
    over: Partial<Parameters<typeof detectLifestyleCreep>[0][number]> = {},
  ) => ({
    id: `id-${date}-${amountCents}`,
    date,
    amountCents,
    rawDescriptor: 'STARBUCKS 800-782-7282',
    accountId: 'a',
    isTransfer: false,
    status: 'POSTED' as const,
    // Every row a provider writes carries a stored category (the pipeline's
    // verdict or the reader's correction); the critic cycle-1 P1-1 rule counts
    // by that stored label alone, so these fixtures state it like the DB does.
    categoryId: over.categoryId ?? 'coffee',
    ...over,
  });

  it('Σ rows === the month figure, on every month of the window', () => {
    const txns = [
      txn('2026-01-03', -5000),
      txn('2026-01-15', -12000),
      txn('2026-01-28', -2500),
      txn('2026-02-06', -9000),
      txn('2026-02-06', -9000, { id: 'feb-2' }), // same day, same descriptor, distinct id
      txn('2026-02-20', -1400),
    ];
    const creep = detectLifestyleCreep(txns, isoDate('2026-06-10'));
    for (const m of creep.monthlyDiscretionaryCents) {
      expect(m.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(m.amountCents);
    }
    expect(creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!.amountCents).toBe(19500);
    expect(creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!.rows).toHaveLength(3);
    expect(creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-02')!.rows).toHaveLength(3);
    // The two identical rows get distinct keys.
    const febRows = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-02')!.rows;
    expect(new Set(febRows.map((r) => r.key)).size).toBe(3);
  });

  it('rows carry the register name when the caller has one, else the normalized bank text', () => {
    const txns = [
      txn('2026-01-03', -5000, { id: 't1', merchantName: 'Starbucks' }),
      txn('2026-01-04', -7000, { id: 't2' }), // no merchantName → normalized
    ];
    const creep = detectLifestyleCreep(txns, isoDate('2026-06-10'));
    const rows = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!.rows;
    expect(rows.find((r) => r.transactionId === 't1')!.label).toBe('Starbucks');
    // rawDescriptor shown only when it differs from the label.
    expect(rows.find((r) => r.transactionId === 't1')!.rawDescriptor).toBe('STARBUCKS 800-782-7282');
    expect(rows.find((r) => r.transactionId === 't2')!.label).not.toBe('STARBUCKS 800-782-7282');
    expect(rows.find((r) => r.transactionId === 't2')!.label.length).toBeGreaterThan(0);
  });

  it('rows are POSTED-only, spend-oriented positive, and never transfers', () => {
    const txns = [
      txn('2026-01-03', -5000), // posted, counts
      txn('2026-01-04', -8000, { status: 'PENDING' }), // pending, out
      txn('2026-01-05', -9000, { isTransfer: true }), // transfer, out
      txn('2026-01-06', 15000, { rawDescriptor: 'REFUND STARBUCKS' }), // positive → income side, never discretionary
    ];
    const creep = detectLifestyleCreep(txns, isoDate('2026-06-10'));
    const m = creep.monthlyDiscretionaryCents.find((x) => x.month === '2026-01')!;
    expect(m.amountCents).toBe(5000);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].amountCents).toBe(5000); // positive, spend-oriented
    expect(m.rows[0].isPending).toBe(false);
  });

  it('reports loanPaymentsExcluded only when the exclusion set is non-empty', () => {
    const creep = detectLifestyleCreep([txn('2026-01-03', -5000)], isoDate('2026-06-10'));
    expect(creep.loanPaymentsExcluded).toBe(false);
    const excluded = detectLifestyleCreep(
      [txn('2026-01-03', -5000)],
      isoDate('2026-06-10'),
      6,
      undefined,
      new Set(['lp-1']),
    );
    expect(excluded.loanPaymentsExcluded).toBe(true);
    const empty = detectLifestyleCreep([txn('2026-01-03', -5000)], isoDate('2026-06-10'), 6, undefined, new Set());
    expect(empty.loanPaymentsExcluded).toBe(false);
  });

  it('flags a month where a return was filed to a discretionary category (gross-vs-net disclosure)', () => {
    const txns = [
      txn('2026-01-03', -5000),
      txn('2026-01-10', -12000),
      txn('2026-01-18', 10000, { categoryId: 'shopping', id: 'refund-jan' }), // AMZN return filed to shopping
      txn('2026-01-25', 250000, { categoryId: 'income', id: 'paycheck-jan' }), // income is NOT a refund flag
    ];    const creep = detectLifestyleCreep(txns, isoDate('2026-06-10'), 6);
    const jan = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!;
    expect(jan.hasDiscretionaryRefunds).toBe(true);
    expect(jan.amountCents).toBe(17000); // the $100.00 refund never nets the bar
    expect(jan.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(17000);
    const feb = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-02')!;
    expect(feb.hasDiscretionaryRefunds).toBe(false);
  });

  it('re-review F1 — a return filed to the app’s own "Refund" category flags too', () => {
    // The CANONICAL case the old rule missed: the reader returns a jacket and
    // picks "Refund" from the picker. That category ships as
    // `{group: 'Income', discretionary: false}`, so the old `discretionary`-only
    // test left the bar gross AND the explanation silent — on exactly the month
    // whose disclosure exists to explain the gap.
    const txns = [
      txn('2026-01-03', -45000, { categoryId: 'shopping', id: 'nordstrom-jan' }),
      txn('2026-01-20', 45000, { categoryId: 'refund', id: 'return-jan' }),
    ];
    const creep = detectLifestyleCreep(txns, isoDate('2026-06-10'), 6);
    const jan = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!;
    expect(jan.hasDiscretionaryRefunds).toBe(true);
    // The bar is still GROSS — that is the behaviour the sentence discloses,
    // not a bug this test blesses away.
    expect(jan.amountCents).toBe(45000);
  });

  it('re-review F1 — a return to a NON-discretionary category does not raise the flag', () => {
    // A grocery return neither enters this bar nor is withheld from it, so
    // disclosing it would explain a divergence that does not exist here.
    const txns = [
      txn('2026-01-03', -45000, { categoryId: 'shopping', id: 'nordstrom-jan' }),
      txn('2026-01-20', 4000, { categoryId: 'groceries', id: 'grocery-return-jan' }),
    ];
    const creep = detectLifestyleCreep(txns, isoDate('2026-06-10'), 6);
    const jan = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!;
    expect(jan.hasDiscretionaryRefunds).toBe(false);
  });

  it('re-review F8 — a $0.00 row is neither spend nor income and never becomes a panel row', () => {
    const txns = [
      txn('2026-01-03', -5000, { categoryId: 'shopping', id: 'real-jan' }),
      txn('2026-01-09', 0, { categoryId: 'shopping', id: 'zero-auth-jan' }),
    ];
    const creep = detectLifestyleCreep(txns, isoDate('2026-06-10'), 6);
    const jan = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!;
    expect(jan.amountCents).toBe(5000);
    // One row, not two: the $0.00 authorization inflated "Show N purchases"
    // without moving the figure by a cent.
    expect(jan.rows).toHaveLength(1);
    expect(jan.rows[0].transactionId).toBe('real-jan');
    // And it may not raise the credit disclosure either.
    expect(jan.hasDiscretionaryRefunds).toBe(false);
  });
});

/**
 * O.20g — the income series is the app's ONE definition of an income row, and a
 * refused comparison is distinguishable from a measured flat one.
 *
 * Measured on the live corpus before this shipped: one real reader's 6-month
 * window held a month with 59 counted rows and ZERO income rows, and the next
 * month held one income row of $0.08 — a first-half median of 8 cents, which
 * cleared the old `first <= 0` guard and produced an income growth of
 * 70,470,525%, silencing the flag while discretionary spending grew ~153%.
 */
describe('creep income series counts only income rows, and says when it cannot measure (O.20g)', () => {
  const txn = (
    date: string,
    amountCents: number,
    over: Partial<Parameters<typeof detectLifestyleCreep>[0][number]> = {},
  ) => ({
    id: `id-${date}-${amountCents}`,
    date,
    amountCents,
    rawDescriptor: 'STARBUCKS 800-782-7282',
    accountId: 'a',
    isTransfer: false,
    status: 'POSTED' as const,
    ...over,
  });
  /** A paycheck in every window month — the coverage `incomeMeasured` needs. */
  const paychecks = (perMonthCents: Record<string, number>) =>
    Object.entries(perMonthCents).map(([m, c]) =>
      txn(`${m}-25`, c, { categoryId: 'paycheck', id: `pay-${m}`, rawDescriptor: 'ACH DEPOSIT ACME PAYROLL' }),
    );
  const WINDOW = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
  const flat = Object.fromEntries(WINDOW.map((m) => [m, 500_000]));
  const today = isoDate('2026-06-10');

  it('the reported P1: merchandise returns no longer count as income, so the flag is not silenced', () => {
    // Flat $5,000 income every month, and discretionary spending growing hard.
    const rising = { '2025-12': 100_000, '2026-01': 100_000, '2026-02': 100_000, '2026-03': 200_000, '2026-04': 200_000, '2026-05': 200_000 };
    const spend = Object.entries(rising).map(([m, c]) => txn(`${m}-10`, -c, { categoryId: 'shopping', id: `buy-${m}` }));
    const base = [...paychecks(flat), ...spend];
    const withoutReturns = detectLifestyleCreep(base, today);
    expect(withoutReturns.flagged).toBe(true);
    expect(withoutReturns.incomeGrowthBps).toBe(0); // flat income, MEASURED
    expect(withoutReturns.incomeMeasured).toBe(true);

    // Returns filed to `refund` in TWO of the three second-half months.
    //
    // Two, not one: the halves are compared by MEDIAN, and a median of three is
    // unmoved by a single perturbed month — so a one-month fixture would pass
    // against the OLD engine too and lock nothing. (It did: the first version of
    // this test was green under a mutation that restored the old branch. "A fix
    // that cannot fail a test is a hypothesis.")
    const returns = [
      txn('2026-03-15', 200_000, { categoryId: 'refund', id: 'return-mar' }),
      txn('2026-04-15', 200_000, { categoryId: 'refund', id: 'return-apr' }),
    ];
    const withReturns = detectLifestyleCreep([...base, ...returns], today);
    // FAIL-OLD: admitting every positive would make the second-half median
    // $7,000 against a $5,000 first half = +4000 bps, which exceeds the spend
    // growth (+100%... no: spend is +10000 bps) — see the flag assertion below.
    expect(withReturns.incomeGrowthBps).toBe(0); // the returns are not a raise
    expect(withReturns.incomeMeasured).toBe(true);
    expect(withReturns.flagged).toBe(true);
  });

  it('FAIL-OLD, executed: returns big enough to clear the flag under the old rule no longer can', () => {
    // The reported failure shape, sized so the OLD rule provably clears the
    // flag: spend grows +50% (5000 bps) while two $20,000 returns would lift a
    // $5,000 income median to $25,000 (+40000 bps) — 5000 - 40000 is far below
    // the +500 bps bar, so the old engine reports "no lifestyle drift".
    const spend = [
      ...['2025-12', '2026-01', '2026-02'].map((m) => txn(`${m}-10`, -100_000, { categoryId: 'shopping', id: `buy-${m}` })),
      ...['2026-03', '2026-04', '2026-05'].map((m) => txn(`${m}-10`, -150_000, { categoryId: 'shopping', id: `buy-${m}` })),
    ];
    const returns = [
      txn('2026-03-15', 2_000_000, { categoryId: 'refund', id: 'big-return-mar' }),
      txn('2026-04-15', 2_000_000, { categoryId: 'refund', id: 'big-return-apr' }),
    ];
    const creep = detectLifestyleCreep([...paychecks(flat), ...spend, ...returns], today);
    expect(creep.spendGrowthBps).toBe(5000);
    expect(creep.incomeGrowthBps).toBe(0); // OLD would be 40000
    expect(creep.flagged).toBe(true); // OLD would be false — the silenced warning
  });

  it('a return filed to a discretionary category is dropped from income, and does NOT net the bar', () => {
    const rows = [
      ...paychecks(flat),
      txn('2026-01-03', -45_000, { categoryId: 'shopping', id: 'buy-jan' }),
      txn('2026-01-20', 45_000, { categoryId: 'shopping', id: 'return-jan' }),
    ];
    const creep = detectLifestyleCreep(rows, today);
    const jan = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!;
    // The bar stays GROSS — the shipped O.20d-FU behaviour this slice must not move.
    expect(jan.amountCents).toBe(45_000);
    expect(jan.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(45_000);
    expect(jan.hasDiscretionaryRefunds).toBe(true);
    // The refused credit leaves the income series and does NOT enter the spend
    // one — it is dropped, not netted. The baseline is the paychecks alone.
    expect(creep.incomeBaselineCents).toBe(500_000);
  });

  it('FAIL-OLD, executed: the first-half BASELINE excludes refused credits', () => {
    // Two of the three first-half months carry a $2,000 return. Under the old
    // rule the first-half median was $7,000; the baseline is the median, so this
    // fixture moves it and a one-month fixture would not.
    const rows = [
      ...paychecks(flat),
      txn('2025-12-20', 200_000, { categoryId: 'refund', id: 'ret-dec' }),
      txn('2026-01-20', 200_000, { categoryId: 'refund', id: 'ret-jan' }),
    ];
    const creep = detectLifestyleCreep(rows, today);
    expect(creep.incomeBaselineCents).toBe(500_000); // OLD: 700_000
  });

  it('an UNCATEGORIZED inflow still counts as income (it may be a deposit, not a return)', () => {
    // The asymmetry `isIncomeFlowRow` has always had, and the reason the panel
    // sentence cannot claim a credit is never counted as income.
    //
    // Two months, not one: the halves are compared by MEDIAN, so a single
    // anomalous month cannot move the figure — which is exactly the property
    // that makes the coverage rule (not a magnitude floor) the right guard.
    const rows = [
      ...paychecks(flat),
      txn('2026-04-15', 200_000, { id: 'unlabelled-apr', rawDescriptor: 'DEPOSIT' }),
      txn('2026-05-15', 200_000, { id: 'unlabelled-may', rawDescriptor: 'DEPOSIT' }),
    ];
    const creep = detectLifestyleCreep(rows, today);
    expect(creep.incomeMeasured).toBe(true);
    // Second-half median $7,000 against a first-half $5,000 = +40%.
    expect(creep.incomeGrowthBps).toBe(4000);
  });

  it('THE RULE: an income baseline below the discretionary spending it is compared against is refused', () => {
    // The live-corpus shape, reduced: the app can see 8 cents a month of income
    // (one interest credit) against $1,000 a month of discretionary spending.
    // Whatever paid for that spending is not in the app, so no growth ratio over
    // the income side means anything.
    const rows = [
      ...WINDOW.map((m) => txn(`${m}-01`, 8, { categoryId: 'interest-income', id: `int-${m}` })),
      ...WINDOW.map((m, i) => txn(`${m}-10`, i < 3 ? -100_000 : -250_000, { categoryId: 'shopping', id: `buy-${m}` })),
    ];
    const creep = detectLifestyleCreep(rows, today);
    expect(creep.incomeBaselineCents).toBe(8);
    expect(creep.discretionaryBaselineCents).toBe(100_000);
    expect(creep.incomeMeasured).toBe(false);
    expect(creep.spendMeasured).toBe(true);
    // The whole point: the comparative claim is withheld rather than made from
    // an 8-cent divisor. Spending grew 150%, so without the rule this reader is
    // told "Spending is outpacing income" over an income the app cannot see.
    expect(creep.spendGrowthBps).toBe(15_000);
    expect(creep.flagged).toBe(false);
  });

  it('the same rule catches the divisor blow-up: a tiny baseline can no longer print or silence', () => {
    // Two of the three first-half months are near-empty, so the MEDIAN itself is
    // tiny and the ratio explodes — the live corpus produced 70,470,525% this
    // way. Spending grew 150%, which under the old engine was silenced because
    // `flagged` is a difference.
    const tiny = { ...flat, '2025-12': 5, '2026-01': 8 };
    const rows = [
      ...paychecks(tiny),
      ...WINDOW.map((m, i) => txn(`${m}-10`, i < 3 ? -100_000 : -250_000, { categoryId: 'shopping', id: `buy-${m}` })),
    ];
    const creep = detectLifestyleCreep(rows, today);
    expect(creep.incomeBaselineCents).toBe(8);
    expect(creep.incomeGrowthBps).toBeGreaterThan(1_000_000); // the raw ratio, still absurd
    expect(creep.incomeMeasured).toBe(false); // …and now known to be meaningless
    expect(creep.flagged).toBe(false);
  });

  it('a SINGLE missing income month does not refuse — the median was already robust to it', () => {
    // The rule is about the baseline, never a count of covered months. A count
    // would silence anyone paid ten months a year (a teacher's summer lands one
    // gap in each half) while both medians are untouched.
    const short = { ...flat };
    delete (short as Record<string, number>)['2026-02'];
    const rows = [
      ...paychecks(short),
      ...WINDOW.map((m, i) => txn(`${m}-10`, i < 3 ? -100_000 : -250_000, { categoryId: 'shopping', id: `buy-${m}` })),
    ];
    const creep = detectLifestyleCreep(rows, today);
    expect(creep.incomeBaselineCents).toBe(500_000); // median of [500000, 500000, 0]
    expect(creep.incomeMeasured).toBe(true);
    expect(creep.flagged).toBe(true); // the correct figure is NOT suppressed
  });

  it('an empty app refuses rather than reporting a tracked, drift-free window', () => {
    const creep = detectLifestyleCreep([], today);
    expect(creep.incomeMeasured).toBe(false);
    expect(creep.spendMeasured).toBe(false);
    expect(creep.flagged).toBe(false);
  });

  it('no discretionary baseline refuses on its own side, leaving the income side measured', () => {
    // Income every month, discretionary spending only in the SECOND half — the
    // first-half median is 0, so there is nothing to grow from.
    const rows = [
      ...paychecks(flat),
      txn('2026-03-10', -100_000, { categoryId: 'shopping', id: 'buy-mar' }),
      txn('2026-04-10', -100_000, { categoryId: 'shopping', id: 'buy-apr' }),
      txn('2026-05-10', -100_000, { categoryId: 'shopping', id: 'buy-may' }),
    ];
    const creep = detectLifestyleCreep(rows, today);
    expect(creep.spendMeasured).toBe(false);
    expect(creep.incomeMeasured).toBe(true);
    expect(creep.flagged).toBe(false);
  });

  it('the degenerate windowMonths=1 refuses on the NaN baseline', () => {
    const creep = detectLifestyleCreep([txn('2026-05-10', -5_000, { categoryId: 'shopping' })], today, 1);
    expect(creep.incomeMeasured).toBe(false);
    expect(creep.spendMeasured).toBe(false);
    expect(creep.flagged).toBe(false);
  });

  it('FAIL-OLD, executed: the flag itself is gated, not merely the copy', () => {
    // The gate has to bind on `flagged`, because `buildReviewCandidates` reads
    // it directly and would emit "spending is outpacing income" — a comparative
    // claim over an income the app cannot see — into the recap and the digest,
    // neither of which goes anywhere near `creepCard`.
    const rows = [
      ...WINDOW.map((m) => txn(`${m}-01`, 8, { categoryId: 'interest-income', id: `int-${m}` })),
      ...WINDOW.map((m, i) => txn(`${m}-10`, i < 3 ? -100_000 : -250_000, { categoryId: 'shopping', id: `buy-${m}` })),
    ];
    const creep = detectLifestyleCreep(rows, today);
    // The arithmetic alone WOULD flag: +150% spend against a flat 8-cent income
    // clears the +5pp bar by a wide margin.
    expect(creep.spendGrowthBps).toBe(15_000);
    expect(creep.incomeGrowthBps).toBe(0);
    expect(creep.spendGrowthBps - creep.incomeGrowthBps).toBeGreaterThanOrEqual(500);
    // So `incomeMeasured` is the ONLY thing holding the claim back.
    expect(creep.incomeMeasured).toBe(false);
    expect(creep.flagged).toBe(false);
  });
});

describe('one discretionary definition: the creep bar classifies with the register (O.20h)', () => {
  const txn = (
    date: string,
    amountCents: number,
    over: Partial<Parameters<typeof detectLifestyleCreep>[0][number]> = {},
  ) => ({
    id: `o20h-${date}-${amountCents}`,
    date,
    amountCents,
    rawDescriptor: 'STARBUCKS 800-782-7282',
    accountId: 'a',
    isTransfer: false,
    status: 'POSTED' as const,
    ...over,
  });
  /** A paycheck in every window month — the coverage `incomeMeasured` needs. */
  const paychecks = (perMonthCents: Record<string, number>) =>
    Object.entries(perMonthCents).map(([m, c]) =>
      txn(`${m}-25`, c, { categoryId: 'paycheck', id: `pay-${m}`, rawDescriptor: 'ACH DEPOSIT ACME PAYROLL' }),
    );
  const WINDOW = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
  const flat = Object.fromEntries(WINDOW.map((m) => [m, 500_000]));
  const today = isoDate('2026-06-10');
  // The pure seed ingested (categories applied exactly as prisma/seed.ts Phase 2
  // writes them) — the shipped label set the register-parity rule counts by.
  const seedTxns = seed.transactions.map((t) => ({
    ...t,
    categoryId: categorize({
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountId: t.accountId,
      isTransfer: t.isTransfer,
    }).categoryId,
  }));

  it('FAIL-OLD, executed: a row the reader marked Fixed leaves the bar and the panel', () => {
    // The O.20h defect itself: a gym membership filed to a discretionary
    // category but overridden Fixed. OLD counted it by category; NEW honors the
    // reader's verdict — the register's "Fixed · you set this" badge now agrees
    // with the bar that counts it.
    const rows = [
      ...paychecks(flat),
      ...WINDOW.map((m, i) =>
        txn(`${m}-10`, i < 3 ? -100_000 : -200_000, {
          categoryId: 'fitness',
          id: `gym-${m}`,
          rawDescriptor: 'PLANET FITNESS #0123',
          spendClassOverride: 'fixed',
        }),
      ),
    ];
    const creep = detectLifestyleCreep(rows, today);
    // The bar is EMPTY on the Fixed rows: spend side unmeasured, first-half
    // median 0, nothing to grow from — the label the reader set is the truth.
    expect(creep.discretionaryBaselineCents).toBe(0);
    expect(creep.spendMeasured).toBe(false);
    expect(creep.flagged).toBe(false);
    for (const m of creep.monthlyDiscretionaryCents) expect(m.rows).toHaveLength(0);
  });

  it('FAIL-OLD, executed: an overridden guilt-free row a non-discretionary category would refuse now counts', () => {
    // The mirror direction — the reader's "this is discretionary" verdict on a
    // non-discretionary category now counts, so the two labels agree in BOTH
    // directions of the override.
    const rows = [
      ...paychecks(flat),
      ...WINDOW.map((m) => txn(`${m}-10`, -80_000, { categoryId: 'groceries', id: `g-${m}`, spendClassOverride: 'guilt-free' })),
    ];
    const creep = detectLifestyleCreep(rows, today);
    const jan = creep.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!;
    expect(jan.amountCents).toBe(80_000);
    expect(jan.rows.map((r) => r.transactionId)).toEqual(['g-2026-01']);
  });

  it('a recurring-bill merchant (detected series) classifies fixed and leaves the bar', () => {
    // The guess tier of the ladder: a real detected outflow series makes its
    // payee a bill, so its charges read Fixed in the register — and now in the
    // bar. FAIL-OLD: the category flag counted them.
    const spends = WINDOW.map((m, i) =>
      txn(`${m}-07`, -90_000, { categoryId: 'fitness', id: `gym-${m}`, rawDescriptor: `PLANET FITNESS #0${100 + i}` }),
    );
    const others = [
      ...paychecks(flat),
      ...WINDOW.map((m, i) =>
        txn(`${m}-10`, -(50_000 + i * 100), { categoryId: 'shopping', id: `buy-${m}`, rawDescriptor: `E2E STORE ${String.fromCharCode(65 + i)}` }),
      ),
    ];
    const series = detectRecurring(
      [...spends, ...others].map((t) => ({ ...t, id: t.id as string })).filter((t) => t.status === 'POSTED'),
      today,
      NO_RECURRING_OVERRIDES,
    );
    const fixedMerchants = new Set(
      series
        .filter((s) => s.typicalAmountCents < 0)
        .map((s) => overrideKey(s.merchantCanonical)),
    );
    expect(fixedMerchants.size).toBe(1); // the engineered Planet Fitness series, only
    const withGuess = detectLifestyleCreep([...spends, ...others], today, 6, undefined, undefined, new Set(), fixedMerchants);
    // FAIL-OLD contrast, same rows without the guess: the gym counted by its
    // category flag (140,100 = 50,100 shopping + 90,000 gym in January).
    const withoutGuess = detectLifestyleCreep([...spends, ...others], today);
    const jan = withGuess.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!;
    expect(withoutGuess.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!.amountCents).toBe(140_100);
    expect(withoutGuess.monthlyDiscretionaryCents.find((m) => m.month === '2026-01')!.rows.map((r) => r.transactionId)).toContain('gym-2026-01');
    // With the guess, the gym leaves the bar — the register labels it Fixed.
    expect(jan.amountCents).toBe(50_100);
    expect(jan.rows.map((r) => r.transactionId)).toEqual(['buy-2026-01']);
    expect(withGuess.monthlyDiscretionaryCents.every((m) => m.rows.every((r) => !r.transactionId!.startsWith('gym-')))).toBe(true);
  });

  it('critic cycle-1 P1-1: a NULL-category row counts by no label the register does not show', () => {
    // The pipeline would file "STARBUCKS" to coffee (discretionary) — and the
    // OLD engine counted it through that guess. The register shows this row
    // with NO label at all ("No class yet"), because `getTransactions` hands
    // the raw null to `classifySpendClass`, which refuses it. FAIL-OLD on BOTH
    // engines: the pre-O.20h taxonomy rule counted it by the guess, and the
    // first O.20h cut classified the RESOLVED category — the same guess. The
    // shipped rule passes the raw row, so an unlabeled row can never count by
    // a label the reader cannot see.
    const rows = [
      ...paychecks(flat),
      ...WINDOW.map((m) => txn(`${m}-12`, -60_000, { id: `unfiled-${m}`, rawDescriptor: 'STARBUCKS 800-782-7282', categoryId: null })),
    ];
    const creep = detectLifestyleCreep(rows, today);
    expect(creep.spendMeasured).toBe(false);
    for (const m of creep.monthlyDiscretionaryCents) expect(m.rows).toHaveLength(0);
  });

  it('an unresolvable uncategorized row also leaves the bar — the register shows it no class to disagree with', () => {
    // The classifier's refusal case that survives: a descriptor the pipeline
    // cannot resolve either. (Companion to the null-category lock above: the
    // register's "No class yet" chip covers both spellings of "no category yet"
    // — raw null and the 'uncategorized' placeholder — and the bar refuses both.)
    const rows = [
      ...paychecks(flat),
      ...WINDOW.map((m) => txn(`${m}-12`, -60_000, { id: `unfiled-${m}`, rawDescriptor: 'ZZQ IMPORTS LLC 4471' })),
    ];
    const creep = detectLifestyleCreep(rows, today);
    expect(creep.spendMeasured).toBe(false);
    for (const m of creep.monthlyDiscretionaryCents) expect(m.rows).toHaveLength(0);
  });

  it('the NO-input defaults keep existing callers byte-identical (the pure seed rides the taxonomy flag)', () => {
    // No overrides, no recurring-bill merchants: `classifySpendClass` reduces to
    // the taxonomy flag over budgetable categories, so every fixture and the
    // pure seed (ingested — no RecurringSeries rows and no overrides; the
    // SEEDED DEMO DB does write 12 detected series, and the shipped demo page
    // loads them through the same unfenced loader; that is the demo register's
    // own classification, which this fix makes the demo bar agree with) measure
    // exactly as before.
    const noInput = detectLifestyleCreep(seedTxns, isoDate('2026-06-10'));
    const withEmpty = detectLifestyleCreep(
      seedTxns,
      isoDate('2026-06-10'),
      6,
      undefined,
      undefined,
      new Set<string>(),
      new Set<string>(),
    );
    expect(withEmpty.flagged).toBe(noInput.flagged);
    expect(withEmpty.spendGrowthBps).toBe(noInput.spendGrowthBps);
    expect(withEmpty.incomeGrowthBps).toBe(noInput.incomeGrowthBps);
    expect(withEmpty.incomeBaselineCents).toBe(noInput.incomeBaselineCents);
    expect(withEmpty.discretionaryBaselineCents).toBe(noInput.discretionaryBaselineCents);
    expect(withEmpty.monthlyDiscretionaryCents.map((m) => m.amountCents)).toEqual(
      noInput.monthlyDiscretionaryCents.map((m) => m.amountCents),
    );
    expect(withEmpty.monthlyDiscretionaryCents.map((m) => m.rows.length)).toEqual(
      noInput.monthlyDiscretionaryCents.map((m) => m.rows.length),
    );
    // The engineered seed rise still flags with no reader input.
    expect(withEmpty.flagged).toBe(true);
  });
});

describe('creepPanelBasis (O.20d)', () => {
  it('embeds the rendered figure and names what counts and what never does', () => {
    const basis = creepPanelBasis('May 2026', cents(12000), false, 0, true);
    expect(basis.length).toBeGreaterThanOrEqual(2);
    expect(basis[0]).toBe(
      'The $120.00 is May 2026’s discretionary spending: the posted purchases your Fixed/Discretionary split labels Discretionary — dining out, shopping, entertainment, and the rest.',
    );
    expect(basis[1]).toContain('transfers, pending rows, and rows you’ve excluded are never in it');
  });

  it('re-review F2 (closed by O.20h) — the bar states the register’s own Fixed/Discretionary basis', () => {
    // The divergence this disclosure used to excuse is GONE: the detector
    // classifies rows with `classifySpendClass` — the reader's verdict, then
    // the recurring-bill guess, then the taxonomy flag — the exact labels the
    // register badges and /budgets lists. The old "counts by category, not by
    // the setting" admission is deleted with the divergence it described; what
    // must hold now is the positive admission rule naming the unified basis.
    for (const hasRefunds of [false, true]) {
      const basis = creepPanelBasis('May 2026', cents(12000), hasRefunds, 0, true);
      const admission = basis.find((s) => s.includes('the same Fixed or Discretionary label the register shows'));
      expect(admission).toBeDefined();
      expect(admission).toContain('your own verdict first');
      expect(basis.join(' ')).not.toContain('not by the Fixed or Discretionary setting');
    }
  });

  it('re-review F6 — the loan-payment sentence is gone: it was window-wide, and vacuous for this figure', () => {
    // `loan-payment` is `discretionary: false`, so an excluded loan payment
    // could never enter a discretionary bar; the old sentence explained an
    // exclusion that cannot move this number, and fired on months where nothing
    // was excluded at all.
    for (const hasRefunds of [false, true]) {
      const basis = creepPanelBasis('May 2026', cents(12000), hasRefunds, 0, true);
      expect(basis.join(' ')).not.toContain('Loan payments');
    }
  });

  it('discloses the gross-vs-net basis only when a discretionary credit occurred', () => {
    expect(creepPanelBasis('May 2026', cents(12000), false, 0, true)).toHaveLength(2);
    const withRefund = creepPanelBasis('May 2026', cents(12000), true, 0, true);
    expect(withRefund).toHaveLength(3);
    expect(withRefund[2]).toContain('does not reduce it');
    // F7: the sentence describes a CREDIT, not "a refund you filed" — the same
    // branch catches a bike sold and filed to 'shopping', and a category the app
    // guessed rather than one the reader chose.
    expect(withRefund[2]).not.toContain('you filed');
    // O.20g — the sentence used to explain the gross-ness by naming where the
    // credit went ("counts as money in"). A return filed to a discretionary
    // category or to Refund is now refused by `isIncomeFlowRow` and never
    // reaches the income series, so that clause became false at exactly the
    // canonical case the disclosure exists for. It may not come back.
    expect(withRefund[2]).not.toContain('counts as money in');
    // Nor may it be replaced by the opposite claim, which is false for the OTHER
    // row this branch catches: an uncategorized credit the pipeline files to a
    // discretionary category IS admitted as income (an inflow the reader never
    // labelled may be a deposit — the F7 argument). The sentence asserts only
    // what holds for every row that reaches it.
    expect(withRefund[2]).not.toContain('not counted as income');
    expect(withRefund[2]).not.toContain("isn't counted as income");
  });
});

describe('room for error + life energy', () => {
  it('runway: $10,000 liquid / $2,500 avg monthly expenses = 4.0 months', () => {
    expect(monthsOfRunway(cents(1_000_000), cents(250_000))).toBe(4);
  });
  it('runwayTitle matches the three Coach card states', () => {
    expect(runwayTitle(4)).toBe('4 months');
    expect(runwayTitle(4.2)).toBe('4.2 months');
    expect(runwayTitle(-2.3)).toBe('no cash buffer');
    expect(runwayTitle(Infinity)).toBe('no expenses yet');
  });
  it('life energy: $190 at $38.00/hr after tax = 5 hours', () => {
    expect(hoursOfWork(cents(19_000), 3800)).toBe(5);
  });
  it('life energy rounds to tenths and ignores sign', () => {
    expect(hoursOfWork(cents(-5700), 3800)).toBe(1.5);
  });
});

describe('monthly Money Review narrative from seed data', () => {
  it('produces one improvement, one creep, one concrete next action', () => {
    const review = generateMoneyReview({
      flows,
      creep: detectLifestyleCreep(seed.transactions, isoDate('2026-06-10')),
      opportunities: findOpportunities(series, 700, 250, []),
      runwayMonths: 3.2,
      pendingTransfer: { amountCents: cents(105_000), byDate: 'Tue, Jun 23', frozenFunding: null },
    });
    expect(review.improvement.length).toBeGreaterThan(10);
    expect(review.creep).toMatch(/Netflix|crept|discretionary/i);
    expect(review.nextAction).toContain('$1,050.00');
    expect(review.nextAction).toContain('Tue, Jun 23');
  });
});
