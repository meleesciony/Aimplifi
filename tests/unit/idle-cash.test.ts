/**
 * Idle-cash lens — pinned to docs/EDGE_CASES.md §Idle cash.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { monthsOfRunway } from '@/lib/engine/fi/insights';
import { IDLE_CASH_CUSHION_MONTHS, idleCash } from '@/lib/engine/fi/idle-cash';
import { cents } from '@/lib/money';

const classic = (over: Partial<Parameters<typeof idleCash>[0]> = {}) =>
  idleCash({
    liquidCents: 2_400_000,
    monthlyExpenseCents: 300_000,
    expenseWindowMonths: 6,
    ...over,
  });

describe('idleCash (EDGE_CASES §Idle cash)', () => {
  it('IC1: $24,000 liquid / $3,000 mo → $6,000 past a $18,000 cushion', () => {
    const row = classic();
    expect(IDLE_CASH_CUSHION_MONTHS).toBe(6);
    expect(row.cushionCents).toBe(1_800_000);
    expect(row.excessCents).toBe(600_000);
    expect(row.runwayMonths).toBe(8);
    expect(row.idle).toBe(false);
    expect(row.noExpenses).toBe(false);
  });

  it('IC2: exactly the cushion is idle — not excess $0', () => {
    const row = classic({ liquidCents: 1_800_000 });
    expect(row.cushionCents).toBe(1_800_000);
    expect(row.excessCents).toBeNull();
    expect(row.idle).toBe(true);
    expect(row.runwayMonths).toBe(6);
  });

  it('IC3: one cent past the cushion is idle — not far', () => {
    const row = classic({ liquidCents: 1_800_001 });
    expect(row.excessCents).toBeNull();
    expect(row.idle).toBe(true);
  });

  it('IC3b: one extra month past the cushion is surplus', () => {
    const row = classic({ liquidCents: 2_100_000 });
    expect(row.excessCents).toBe(300_000);
    expect(row.runwayMonths).toBe(7);
    expect(row.idle).toBe(false);
  });

  it('IC4: $0 expenses is noExpenses — no $0 cushion', () => {
    const row = classic({ monthlyExpenseCents: 0 });
    expect(row.noExpenses).toBe(true);
    expect(row.idle).toBe(true);
    expect(row.cushionCents).toBeNull();
    expect(row.excessCents).toBeNull();
  });

  it('IC5: $0 liquid with expenses is idle, not a shortfall figure', () => {
    const row = classic({ liquidCents: 0 });
    expect(row.cushionCents).toBe(1_800_000);
    expect(row.excessCents).toBeNull();
    expect(row.idle).toBe(true);
  });

  it('IC6: negative liquid stays negative and does not invent a shortfall', () => {
    const row = classic({ liquidCents: -50_000 });
    expect(row.liquidCents).toBe(-50_000);
    expect(row.excessCents).toBeNull();
    expect(row.idle).toBe(true);
  });

  it('IC7: runway and cushion share the runway authors', () => {
    const row = classic();
    expect(row.runwayMonths).toBe(monthsOfRunway(cents(2_400_000), cents(300_000)));
    expect(row.cushionCents).toBe(300_000 * IDLE_CASH_CUSHION_MONTHS);
    const noExp = classic({ monthlyExpenseCents: 0, liquidCents: 500_000 });
    expect(noExp.runwayMonths).toBe(monthsOfRunway(cents(500_000), cents(0)));
  });
});

describe('Idle-cash copy honesty', () => {
  it('test_regression__idle_cash_zero_expenses_is_idle_not_a_surplus_claim', () => {
    const empty = COACH_COPY.idleCashEmpty(classic({ monthlyExpenseCents: 0 }));
    expect(empty).toMatch(/no average expenses/i);
    expect(empty).toMatch(/same expense average the runway figure uses/);
    expect(empty).not.toMatch(/\$0\.00 cushion|past a 6-month|you should/i);
    expect(empty).not.toMatch(/this card|\bbelow\b/i);
    expect(COACH_COPY.idleCash(classic({ monthlyExpenseCents: 0 }))).toBeNull();
  });

  it('test_regression__idle_cash_names_only_this_liquid_and_does_not_nudge', () => {
    const text = COACH_COPY.idleCash(classic())!;
    expect(text).toContain('$6,000.00');
    expect(text).toContain('$18,000.00');
    expect(text).toContain('$24,000.00');
    expect(text).toMatch(/checking and savings/i);
    expect(text).toMatch(/same expense average the runway figure uses/);
    expect(text).toMatch(/never moves money/);
    expect(text).toMatch(/not a recommendation/i);
    expect(text).toMatch(/at least one month of those expenses/);
    expect(text).not.toMatch(/you should|move your money|open an account at/i);
    expect(text).not.toMatch(/this card|\bbelow\b|\bhere\b/i);
    expect(text).not.toMatch(/pays little|high-yield|HYSA|park the extra/i);
    expect(text).not.toMatch(/\b(VTSAX|VTI|VOO|APY|4\.00%)\b/);
  });

  it('test_regression__idle_cash_does_not_block_accounts_list_on_coach', () => {
    const src = readFileSync('src/app/(app)/accounts/page.tsx', 'utf8');
    expect(src).not.toMatch(/getCoachData/);
    expect(src).not.toMatch(/IdleCashCard/);
    expect(src).not.toMatch(/idle-cash/);
  });

  it('test_regression__idle_cash_names_runway_expense_window', () => {
    const idle = COACH_COPY.idleCashIdle(classic({ liquidCents: 1_800_000 }));
    expect(idle).toContain('$18,000.00');
    expect(idle).toMatch(/last 6 complete months/);
    expect(idle).toMatch(/same expense average the runway figure uses/);
    expect(idle).not.toMatch(/this card|\bbelow\b|\bhere\b/i);
    const one = COACH_COPY.idleCashEmpty(
      idleCash({
        liquidCents: 100_000,
        monthlyExpenseCents: 0,
        expenseWindowMonths: 1,
      }),
    );
    expect(one).toMatch(/last 1 complete month/);
  });

  it('test_regression__idle_cash_one_cent_past_cushion_is_idle_not_far', () => {
    const row = classic({ liquidCents: 1_800_001 });
    expect(row.idle).toBe(true);
    expect(COACH_COPY.idleCash(row)).toBeNull();
    const idle = COACH_COPY.idleCashIdle(row);
    expect(idle).toMatch(/past a 6-month cash cushion of \$18,000\.00/);
    expect(idle).toMatch(/does not name a surplus/);
    expect(idle).not.toMatch(/at or under/);
    expect(idle).not.toMatch(/\$0\.00 past|pays little|high-yield/i);
  });

  it('test_regression__idle_cash_past_cushion_not_far_does_not_say_at_or_under', () => {
    const row = classic({ liquidCents: 2_099_999 });
    expect(row.idle).toBe(true);
    expect(row.runwayMonths).toBe(7);
    const idle = COACH_COPY.idleCashIdle(row);
    expect(idle).toContain('$20,999.99');
    expect(idle).toMatch(/about 7 months/);
    expect(idle).toMatch(/past a 6-month cash cushion of \$18,000\.00/);
    expect(idle).toMatch(/does not name a surplus/);
    expect(idle).not.toMatch(/at or under/);
  });

  it('test_regression__idle_cash_title_is_a_lens_not_a_surplus_claim', () => {
    expect(COACH_COPY.idleCashTitle()).toBe('Cash vs a 6-month cushion');
    expect(COACH_COPY.idleCashTitle()).not.toMatch(/past/);
  });

  it('test_regression__idle_cash_negative_liquid_is_not_a_shortfall_sentence', () => {
    const idle = COACH_COPY.idleCashIdle(classic({ liquidCents: -50_000 }));
    expect(idle).toMatch(/negative/);
    expect(idle).toMatch(/no surplus/);
    expect(idle).not.toMatch(/— \$.* past a 6-month/);
    expect(idle).not.toMatch(/you should|shortfall of/i);
    expect(COACH_COPY.idleCash(classic({ liquidCents: -50_000 }))).toBeNull();
  });
});
