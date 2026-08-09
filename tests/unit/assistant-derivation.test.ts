/**
 * Glass-Box slice 3 — derivation-chain traces (GLASSBOX_PLAN §Slice 3): the
 * "show the formula + inputs" view for cash_needed / net_worth / savings_rate.
 * These are NOT transaction row-sums; a fake row-sum would be dishonest. The
 * trace RESHAPES the engine result it is handed (the glass-box cardinal rule —
 * no parallel derivation that can drift), and every equality below is a real
 * runtime gate: builder figure vs trace recomputation, computed independently.
 *
 * Acceptance criteria (build-loop step 1) are the numbered describe blocks.
 */
import { describe, expect, it } from 'vitest';
import {
  traceCashNeededDerivation,
  traceNetWorthDerivation,
  traceSavingsRateDerivation,
  type DerivationTrace,
} from '@/lib/engine/assistant/derivation';
import { answerCashNeeded, answerNetWorth, answerSavingsRate, type AccountLike } from '@/lib/engine/assistant/answer';
import { netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { traceCashNeeded as glassBoxTraceCashNeeded } from '@/lib/engine/glass-box/trace';
import { savingsRateBps } from '@/lib/engine/fi/fi';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CardSnapshot, CashNeededInput } from '@/lib/engine/cash-needed/types';
import { cents } from '@/lib/money';
import { holidayTable, isoDate } from '@/lib/dates';

const d = isoDate;
const HOLIDAYS = holidayTable(2025, 2027);

// ─── fixtures ────────────────────────────────────────────────────────────────

/** Mixed accounts, hand-computed:
 *  assets: checking 5,000.00 + savings 12,000.00 + investment 80,000.00 − overdrawn 25.00
 *        = 96,975.00 (the overdraft is a NEGATIVE-contribution ASSET, not a liability)
 *  liabilities: credit 2,400.00 + loan 15,000.00 + paid-off card 0.00 = 17,400.00
 *  net = 96,975.00 − 17,400.00 = 79,575.00
 */
const ACCOUNTS: AccountLike[] = [
  { id: 'chk', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 500000, feedDroppedAt: null },
  { id: 'sav', name: 'Rainy Day Savings', type: 'SAVINGS', currentBalanceCents: 1200000, feedDroppedAt: null },
  { id: 'inv', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 8000000, feedDroppedAt: null },
  { id: 'ovr', name: 'Old Checking', type: 'CHECKING', currentBalanceCents: -2500, feedDroppedAt: null },
  { id: 'cc', name: 'Sapphire Card', type: 'CREDIT', currentBalanceCents: 240000, feedDroppedAt: null },
  { id: 'loan', name: 'Auto Loan', type: 'LOAN', currentBalanceCents: 1500000, feedDroppedAt: null },
  { id: 'paid', name: 'Paid-Off Card', type: 'CREDIT', currentBalanceCents: 0, feedDroppedAt: null },
];
const NET = 7957500;

function card(over: Partial<CardSnapshot> & { id: string; name: string }): CardSnapshot {
  return {
    aprBps: 2400,
    autopay: null,
    statement: null,
    currentBalanceCents: cents(0),
    paymentsAppliedCents: cents(0),
    ...over,
  };
}
function statement(balance: number, dueDate: string, min = 3500, cycleEnd = '2026-05-18') {
  return {
    statementBalanceCents: cents(balance),
    minimumPaymentCents: cents(min),
    dueDate: d(dueDate),
    cycleEnd: d(cycleEnd),
  };
}
function input(over: Partial<CashNeededInput>): CashNeededInput {
  return {
    today: d('2026-06-10'),
    paymentAccount: { name: 'Checking', balanceCents: cents(340000), pending: [], frozenSince: null },
    cards: [],
    scheduled: [],
    scenario: 'PAY_IN_FULL',
    holidayTable: HOLIDAYS,
    ...over,
  };
}

/** Mixed cycle: two real statements due (2,100.00 + 2,712.33), one $0-due real
 *  statement, one estimated (no statement, balance 900.00 — NEXT cycle, excluded).
 *  headline = 4,812.33; firstDueDate = 06-15 (the trace's "by DATE"), byDate =
 *  the later effective due date (the projection horizon).
 */
const MIXED = computeCashNeeded(
  input({
    cards: [
      card({ id: 'amex', name: 'Amex', statement: statement(210000, '2026-06-15') }),
      card({ id: 'chase', name: 'Chase', statement: statement(271233, '2026-06-17') }),
      card({ id: 'zero', name: 'Zero Card', statement: statement(0, '2026-06-20') }),
      card({ id: 'est', name: 'Store Card', currentBalanceCents: cents(90000), nextDueDate: d('2026-07-15') }),
    ],
  }),
);

const rowSum = (t: DerivationTrace) => t.rows.reduce((s, r) => s + r.amountCents, 0);

// ─── 1. net_worth: signed account rows reconcile to the engine's own figure ──

describe('1 — traceNetWorthDerivation: assets − liabilities, lockstep with netWorthCents', () => {
  const t = traceNetWorthDerivation(ACCOUNTS, NET);

  it('reconciles: row sum === netCents === netWorthCents(accounts) === expected', () => {
    expect(t.intentKind).toBe('net_worth');
    if (t.intentKind !== 'net_worth') return;
    expect(t.reconciled).toBe(true);
    expect(t.netCents).toBe(NET);
    expect(t.netCents).toBe(netWorthCents([...ACCOUNTS]));
    expect(rowSum(t)).toBe(t.sumCents);
    expect(t.sumCents).toBe(t.netCents);
  });

  it('every account appears exactly once (a partition — nothing dropped or doubled)', () => {
    expect(t.rows).toHaveLength(ACCOUNTS.length);
    expect(new Set(t.rows.map((r) => r.label)).size).toBe(ACCOUNTS.length);
  });

  it('group comes from isLiabilityType, never sign inference: the overdrawn checking is a negative ASSET; the $0 credit card is a LIABILITY', () => {
    const overdrawn = t.rows.find((r) => r.label === 'Old Checking');
    expect(overdrawn?.group).toBe('asset');
    expect(overdrawn?.amountCents).toBe(-2500);
    const paidOff = t.rows.find((r) => r.label === 'Paid-Off Card');
    expect(paidOff?.group).toBe('liability');
    expect(paidOff?.amountCents).toBe(0);
  });

  it('liability rows contribute NEGATED balances (credit 2,400.00 owed → −240,000 cents)', () => {
    expect(t.rows.find((r) => r.label === 'Sapphire Card')?.amountCents).toBe(-240000);
  });

  it('hand-computed subtotals: assets 96,975.00 − liabilities 17,400.00 = 79,575.00', () => {
    const assets = t.rows.filter((r) => r.group === 'asset').reduce((s, r) => s + r.amountCents, 0);
    const owed = -t.rows.filter((r) => r.group === 'liability').reduce((s, r) => s + r.amountCents, 0);
    expect(assets).toBe(9697500);
    expect(owed).toBe(1740000);
    expect(assets - owed).toBe(NET);
  });

  it('a negative net worth reconciles (honest, never clamped)', () => {
    const under: AccountLike[] = [
      { id: 'c', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100000, feedDroppedAt: null },
      { id: 'l', name: 'Big Loan', type: 'LOAN', currentBalanceCents: 500000, feedDroppedAt: null },
    ];
    const tt = traceNetWorthDerivation(under, -400000);
    expect(tt.reconciled).toBe(true);
    if (tt.intentKind === 'net_worth') expect(tt.netCents).toBe(-400000);
  });

  it('drift guard (false-negative proof): a 1¢-off expected figure → reconciled: false', () => {
    expect(traceNetWorthDerivation(ACCOUNTS, NET + 1).reconciled).toBe(false);
  });

  it('no accounts → the builder withholds the tap entirely (critic F6: no hollow "$0.00 − $0.00" panel)', () => {
    expect(answerNetWorth([]).headlineCents).toBeUndefined();
  });
});

// ─── 2. cash_needed: reshape of the engine result, in lockstep with the ─────
//        existing glass-box trace (the two surfaces can never disagree)

describe('2 — traceCashNeededDerivation: per-card due rows reconcile to headline.requiredCents', () => {
  const t = traceCashNeededDerivation(MIXED, MIXED.headline.requiredCents);

  it('reconciles: row sum === requiredCents === expected; byDate matches', () => {
    expect(t.intentKind).toBe('cash_needed');
    if (t.intentKind !== 'cash_needed') return;
    expect(t.reconciled).toBe(true);
    expect(t.requiredCents).toBe(481233);
    expect(rowSum(t)).toBe(481233);
    // The trace restates the headline's "by DATE" claim — the FIRST due (audit P2).
    expect(t.byDate).toBe(MIXED.headline.firstDueDate);
  });

  it('cites exactly the due set: the $0-due card and the next-cycle estimated card are NOT rows', () => {
    const labels = t.rows.map((r) => r.label);
    expect(labels).toContain('Amex');
    expect(labels).toContain('Chase');
    expect(labels).not.toContain('Zero Card');
    expect(labels).not.toContain('Store Card');
  });

  it('every row carries its effective due date', () => {
    expect(t.rows.every((r) => typeof r.date === 'string' && r.date.length === 10)).toBe(true);
  });

  it('parity lock: row sum equals the dashboard glass-box trace sum for the SAME result', () => {
    expect(rowSum(t)).toBe(glassBoxTraceCashNeeded(MIXED).sumCents);
  });

  it('discloses the excluded next-cycle card in basis', () => {
    expect(t.basis.some((b) => b.includes('next cycle'))).toBe(true);
  });

  it('all-estimated cycle: estimated cards ARE the answer, reconciled, disclosed', () => {
    const est = computeCashNeeded(
      input({
        cards: [card({ id: 'only', name: 'Only Card', currentBalanceCents: cents(120000), nextDueDate: d('2026-06-25') })],
      }),
    );
    const tt = traceCashNeededDerivation(est, est.headline.requiredCents);
    expect(tt.reconciled).toBe(true);
    expect(tt.rows).toHaveLength(1);
    expect(tt.rows[0].isEstimated).toBe(true);
    // The glass-box disclosure sentence: rows marked "est." use the current
    // balance because a statement has not been generated yet.
    expect(tt.basis.some((b) => b.includes('statement has not been generated'))).toBe(true);
  });

  it('drift guard: a doctored expected figure → reconciled: false', () => {
    expect(traceCashNeededDerivation(MIXED, MIXED.headline.requiredCents + 100).reconciled).toBe(false);
  });

  it('an autopay card carries its autopayCents onto the row (critic F5: the "(autopay)" marker the dashboard shows for the same figure)', () => {
    const auto = computeCashNeeded(
      input({
        cards: [
          card({
            id: 'auto',
            name: 'Auto Card',
            statement: statement(120000, '2026-06-18'),
            autopay: { mode: 'STATEMENT_BALANCE' },
          }),
        ],
      }),
    );
    const tt = traceCashNeededDerivation(auto, auto.headline.requiredCents);
    expect(tt.reconciled).toBe(true);
    expect(tt.rows[0].autopayCents).toBe(120000);
  });

  it('drift guard: an internally inconsistent result (mutated row) → reconciled: false', () => {
    const mutated = structuredClone(MIXED);
    mutated.perDueDate[0].cards[0].amountCents = cents(mutated.perDueDate[0].cards[0].amountCents + 1);
    expect(traceCashNeededDerivation(mutated, MIXED.headline.requiredCents).reconciled).toBe(false);
  });
});

// ─── 3. savings_rate: income − expenses = saved; saved ÷ income = rate ───────

describe('3 — traceSavingsRateDerivation: the ratio recomputed via the SAME savingsRateBps', () => {
  const FLOW = { incomeCents: 650000, expensesCents: 520000, monthLabel: 'June 2026' };
  const EXPECT_BPS = savingsRateBps(cents(650000), cents(520000))!; // 2000 bps = 20.0%

  it('reconciles: rows [+income, −expenses] sum to savedCents; rateBps === expected', () => {
    const t = traceSavingsRateDerivation(FLOW, EXPECT_BPS);
    expect(t.intentKind).toBe('savings_rate');
    if (t.intentKind !== 'savings_rate') return;
    expect(t.reconciled).toBe(true);
    expect(t.rows).toHaveLength(2);
    expect(rowSum(t)).toBe(130000);
    expect(t.savedCents).toBe(130000);
    expect(t.incomeCents).toBe(650000);
    expect(t.expensesCents).toBe(520000);
    expect(t.rateBps).toBe(2000);
    expect(t.monthLabel).toBe('June 2026');
  });

  it('a negative savings rate reconciles (spending > income is stated, never clamped)', () => {
    const income = 400000;
    const expenses = 500000;
    const bps = savingsRateBps(cents(income), cents(expenses))!; // −2500
    const t = traceSavingsRateDerivation({ incomeCents: income, expensesCents: expenses, monthLabel: 'May 2026' }, bps);
    expect(t.reconciled).toBe(true);
    if (t.intentKind === 'savings_rate') {
      expect(t.savedCents).toBe(-100000);
      expect(t.rateBps).toBe(-2500);
    }
  });

  it('drift guard (the coach-definition-change canary): expected bps ≠ recomputed bps → reconciled: false', () => {
    expect(traceSavingsRateDerivation(FLOW, EXPECT_BPS + 1).reconciled).toBe(false);
  });

  it('zero income (rate undefined) can never reconcile', () => {
    expect(
      traceSavingsRateDerivation({ incomeCents: 0, expensesCents: 100, monthLabel: 'May 2026' }, 0).reconciled,
    ).toBe(false);
  });
});

// ─── 4. builders declare their own figure — the independent half of the gate ─

describe('4 — builders set headlineCents / headlineBps from their OWN figure (absent → no tap)', () => {
  it('answerNetWorth.headlineCents === netWorthCents(accounts)', () => {
    expect(answerNetWorth(ACCOUNTS).headlineCents).toBe(NET);
  });

  it('answerCashNeeded.headlineCents === headline.requiredCents when cards are due', () => {
    expect(answerCashNeeded(MIXED, 'Checking').headlineCents).toBe(481233);
  });

  it('answerCashNeeded with nothing due sets NO headlineCents (no figure → no tap)', () => {
    const none = computeCashNeeded(input({ cards: [card({ id: 'z', name: 'Z', statement: statement(0, '2026-06-20') })] }));
    expect(answerCashNeeded(none, 'Checking').headlineCents).toBeUndefined();
  });

  it('answerSavingsRate.headlineBps === rateBps; null rate sets NO headlineBps', () => {
    const a = answerSavingsRate({ rateBps: 2000, incomeCents: 650000, expensesCents: 520000, monthLabel: 'June 2026' });
    expect(a.headlineBps).toBe(2000);
    const none = answerSavingsRate({ rateBps: null, incomeCents: 0, expensesCents: 0, monthLabel: '' });
    expect(none.headlineBps).toBeUndefined();
  });

  it('headline percent and trace percent come from the same bps (one formatter, no display drift)', () => {
    const a = answerSavingsRate({ rateBps: 1234, incomeCents: 650000, expensesCents: 520000, monthLabel: 'June 2026' });
    expect(a.headline).toContain('12.3%');
  });
});
