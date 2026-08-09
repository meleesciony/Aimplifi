/**
 * Glass-Box slice 3 — `derivationView` gate. The formula panel opens ONLY when
 * this pure, client-safe gate re-verifies the whole chain LOCALLY (factView's
 * stance): engine-reconciled trace → lines re-sum → the formula re-run over the
 * DISPLAYED lines produces the DISPLAYED result. A mutated payload — even one
 * still flagged `reconciled: true` — must return null (plain text, honest
 * non-offer), never a formula that doesn't produce the number on screen.
 *
 * Traces are built through the REAL engine builders (not literals) so the gate
 * is tested against exactly what the server ships; mutations then break one
 * link at a time.
 */
import { describe, expect, it } from 'vitest';
import {
  traceCashNeededDerivation,
  traceNetWorthDerivation,
  traceSavingsRateDerivation,
  type DerivationTrace,
} from '@/lib/engine/assistant/derivation';
import { bpsToPct1dp, derivationView } from '@/lib/engine/assistant/trace-view';
import type { AccountLike } from '@/lib/engine/assistant/answer';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CardSnapshot, CashNeededInput } from '@/lib/engine/cash-needed/types';
import { cents } from '@/lib/money';
import { holidayTable, isoDate } from '@/lib/dates';

const d = isoDate;

const ACCOUNTS: AccountLike[] = [
  { id: 'chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500000, feedDroppedAt: null },
  { id: 'cc', name: 'Card', type: 'CREDIT', currentBalanceCents: 120000, feedDroppedAt: null },
];
const NET = 380000;

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
const CASH = computeCashNeeded({
  today: d('2026-06-10'),
  paymentAccount: { name: 'Checking', balanceCents: cents(900000), pending: [], frozenSince: null },
  cards: [
    card({
      id: 'amex',
      name: 'Amex',
      statement: { statementBalanceCents: cents(210000), minimumPaymentCents: cents(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-05-18') },
    }),
    card({
      id: 'chase',
      name: 'Chase',
      statement: { statementBalanceCents: cents(150000), minimumPaymentCents: cents(3500), dueDate: d('2026-06-17'), cycleEnd: d('2026-05-18') },
    }),
  ],
  scheduled: [],
  scenario: 'PAY_IN_FULL',
  holidayTable: holidayTable(2025, 2027),
} satisfies CashNeededInput);

const FLOW = { incomeCents: 650000, expensesCents: 520000, monthLabel: 'June 2026' };

const netWorth = () => traceNetWorthDerivation(ACCOUNTS, NET);
const cashNeeded = () => traceCashNeededDerivation(CASH, CASH.headline.requiredCents);
const savingsRate = () => traceSavingsRateDerivation(FLOW, 2000);

/** Deep-clone then mutate — payload tampering the flag doesn't know about. */
function mutated(t: DerivationTrace, fn: (m: DerivationTrace) => void): DerivationTrace {
  const m = structuredClone(t);
  fn(m);
  return m;
}

describe('derivationView — intact engine-built traces pass', () => {
  it('net_worth / cash_needed / savings_rate all open', () => {
    expect(derivationView(netWorth())).not.toBeNull();
    expect(derivationView(cashNeeded())).not.toBeNull();
    expect(derivationView(savingsRate())).not.toBeNull();
  });

  it('non-derivation input never opens: undefined, row_sum, not_row_sum', () => {
    expect(derivationView(undefined)).toBeNull();
    expect(derivationView({ kind: 'not_row_sum', intentKind: 'forecast' })).toBeNull();
  });

  it('an engine-unreconciled trace never opens (drifted expected figure)', () => {
    expect(derivationView(traceNetWorthDerivation(ACCOUNTS, NET + 1))).toBeNull();
    expect(derivationView(traceSavingsRateDerivation(FLOW, 1999))).toBeNull();
  });
});

describe('derivationView — the local recheck stands on its own (reconciled flag alone is not trusted)', () => {
  it('net_worth: a mutated account line → null', () => {
    expect(derivationView(mutated(netWorth(), (m) => void (m.rows[0].amountCents += 1)))).toBeNull();
  });

  it('net_worth: a mutated netCents (formula no longer lands on the shown result) → null', () => {
    expect(
      derivationView(mutated(netWorth(), (m) => m.intentKind === 'net_worth' && void ((m.netCents += 100), (m.sumCents += 100)))),
    ).toBeNull();
  });

  it('net_worth: a line missing its formula side (group) → null (it would vanish from both columns)', () => {
    expect(derivationView(mutated(netWorth(), (m) => void delete m.rows[0].group))).toBeNull();
  });

  it('net_worth: no lines at all → null (critic F6 — the local guard stands even if a trace slips through)', () => {
    expect(derivationView(traceNetWorthDerivation([], 0))).toBeNull();
  });

  it('any kind: a fractional-cents line → null even when the sums still match (critic-2 P2-3 — a malformed money string must never render under the ✓)', () => {
    expect(
      derivationView(
        mutated(netWorth(), (m) => {
          if (m.intentKind !== 'net_worth') return;
          // Split one line into x+0.5 / y−0.5: every sum equality still holds.
          m.rows[0].amountCents += 0.5;
          m.rows[1].amountCents -= 0.5;
        }),
      ),
    ).toBeNull();
  });

  it('cash_needed: a mutated card line → null', () => {
    expect(derivationView(mutated(cashNeeded(), (m) => void (m.rows[0].amountCents -= 50)))).toBeNull();
  });

  it('cash_needed: a byDate that no row backs → null (the "by DATE" is part of the claim)', () => {
    expect(
      derivationView(mutated(cashNeeded(), (m) => m.intentKind === 'cash_needed' && void (m.byDate = '2026-06-30'))),
    ).toBeNull();
  });

  it('cash_needed: byDate must back the EARLIEST row — the LAST row no longer counts (audit P2)', () => {
    // The trace restates the headline's first-due "by DATE"; the old
    // latest-row semantics would pass a last-due date through silently.
    const trace = cashNeeded();
    const last = trace.rows.reduce((m, r) => (r.date! > m ? r.date! : m), trace.rows[0]!.date!);
    expect(
      derivationView(mutated(trace, (m) => m.intentKind === 'cash_needed' && void (m.byDate = last))),
    ).toBeNull();
  });

  it('cash_needed: a dateless row → null', () => {
    expect(derivationView(mutated(cashNeeded(), (m) => void delete m.rows[0].date))).toBeNull();
  });

  it('savings_rate: a mutated rate (display no longer equals the recompute) → null', () => {
    expect(
      derivationView(mutated(savingsRate(), (m) => m.intentKind === 'savings_rate' && void (m.rateBps += 1))),
    ).toBeNull();
  });

  it('savings_rate: savedCents that is not income − expenses → null', () => {
    expect(
      derivationView(
        mutated(savingsRate(), (m) => m.intentKind === 'savings_rate' && void ((m.savedCents += 100), (m.sumCents += 100), (m.rows[0].amountCents += 100))),
      ),
    ).toBeNull();
  });

  it('savings_rate: a non-integer payload returns null, never throws (cents() would)', () => {
    expect(
      derivationView(
        mutated(savingsRate(), (m) => {
          if (m.intentKind !== 'savings_rate') return;
          m.incomeCents = 650000.5;
          m.expensesCents = 520000.5;
          // keep the arithmetic identities so ONLY the integer guard can catch it
          m.savedCents = 130000;
          m.sumCents = 130000;
          m.rows[0].amountCents = 650000.5;
          m.rows[1].amountCents = -520000.5;
        }),
      ),
    ).toBeNull();
  });
});

describe('bpsToPct1dp — the ONE percent formatter (headline and panel cannot diverge)', () => {
  it('formats to one decimal place, signed', () => {
    expect(bpsToPct1dp(2000)).toBe('20.0');
    expect(bpsToPct1dp(1234)).toBe('12.3');
    expect(bpsToPct1dp(-2500)).toBe('-25.0');
    expect(bpsToPct1dp(0)).toBe('0.0');
  });
});
