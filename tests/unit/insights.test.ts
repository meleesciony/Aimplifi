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
  monthlyFlows,
  monthsOfRunway,
} from '@/lib/engine/fi/insights';
import { generateMoneyReview } from '@/lib/engine/fi/coach-copy';
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

const seed = buildSeedData('2026-06-10');
const flows = monthlyFlows(seed.transactions);
const series = detectRecurring(
  seed.transactions.filter((t) => t.status === 'POSTED'),
  isoDate('2026-06-10'),
  NO_RECURRING_OVERRIDES,
);

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
  const opportunities = findOpportunities(series, 700, 250);

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
});

describe('lifestyle-creep detector on the engineered seed rise', () => {
  it('flags the final-6-months discretionary rise against flat income', () => {
    const creep = detectLifestyleCreep(seed.transactions, isoDate('2026-06-10'));
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
    ];
    const creep = detectLifestyleCreep(txns, isoDate('2026-06-10'), 6);
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

describe('creepPanelBasis (O.20d)', () => {
  it('embeds the rendered figure and names what counts and what never does', () => {
    const basis = creepPanelBasis('May 2026', cents(12000), false);
    expect(basis.length).toBeGreaterThanOrEqual(2);
    expect(basis[0]).toBe(
      'The $120.00 is May 2026’s discretionary spending: posted purchases in a discretionary category — dining out, shopping, entertainment, and the other categories the app treats as discretionary.',
    );
    expect(basis[1]).toContain('transfers, pending rows, and rows you’ve excluded are never in it');
  });

  it('re-review F2 — always admits it counts by category, not by the Fixed/Discretionary setting', () => {
    // The register labels a detected gym membership "Fixed"; this bar counts it
    // anyway, because "discretionary" here is the category's taxonomy flag. The
    // panel lists the row, so the contradiction is now visible to the reader and
    // must be stated rather than discovered.
    for (const hasRefunds of [false, true]) {
      const basis = creepPanelBasis('May 2026', cents(12000), hasRefunds);
      const admission = basis.find((s) => s.includes('not by the Fixed or Discretionary setting'));
      expect(admission).toBeDefined();
      expect(admission).toContain('marked Fixed is still counted here');
    }
  });

  it('re-review F6 — the loan-payment sentence is gone: it was window-wide, and vacuous for this figure', () => {
    // `loan-payment` is `discretionary: false`, so an excluded loan payment
    // could never enter a discretionary bar; the old sentence explained an
    // exclusion that cannot move this number, and fired on months where nothing
    // was excluded at all.
    for (const hasRefunds of [false, true]) {
      const basis = creepPanelBasis('May 2026', cents(12000), hasRefunds);
      expect(basis.join(' ')).not.toContain('Loan payments');
    }
  });

  it('discloses the gross-vs-net basis only when a discretionary credit occurred', () => {
    expect(creepPanelBasis('May 2026', cents(12000), false)).toHaveLength(3);
    const withRefund = creepPanelBasis('May 2026', cents(12000), true);
    expect(withRefund).toHaveLength(4);
    expect(withRefund[3]).toContain('counts as money in, not as a reduction of this figure');
    // F7: the sentence describes a CREDIT, not "a refund you filed" — the same
    // branch catches a bike sold and filed to 'shopping', and a category the app
    // guessed rather than one the reader chose.
    expect(withRefund[3]).not.toContain('you filed');
  });
});

describe('room for error + life energy', () => {
  it('runway: $10,000 liquid / $2,500 avg monthly expenses = 4.0 months', () => {
    expect(monthsOfRunway(cents(1_000_000), cents(250_000))).toBe(4);
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
      opportunities: findOpportunities(series, 700, 250),
      runwayMonths: 3.2,
      pendingTransfer: { amountCents: cents(105_000), byDate: 'Tue, Jun 23', frozenFunding: null },
    });
    expect(review.improvement.length).toBeGreaterThan(10);
    expect(review.creep).toMatch(/Netflix|crept|discretionary/i);
    expect(review.nextAction).toContain('$1,050.00');
    expect(review.nextAction).toContain('Tue, Jun 23');
  });
});
