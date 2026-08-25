/**
 * PAW expected-net-worth lens — pinned to docs/EDGE_CASES.md §PAW.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  PAW_NEAR_BPS,
  annualIncomeFromMonthly,
  normalizePawAge,
  pawBand,
  pawLens,
} from '@/lib/engine/networth/paw-lens';
import { cents } from '@/lib/money';

const classic = (over: Partial<Parameters<typeof pawLens>[0]> = {}) =>
  pawLens({
    ageYears: 40,
    annualIncomeCents: 10_000_000,
    netWorthCents: 40_000_000,
    incomeWindowMonths: 6,
    ...over,
  });

describe('annualIncomeFromMonthly / normalizePawAge', () => {
  it('annualizes monthly × 12 and floors negatives', () => {
    expect(annualIncomeFromMonthly(500_000)).toBe(6_000_000);
    expect(annualIncomeFromMonthly(0)).toBe(0);
    expect(annualIncomeFromMonthly(-100)).toBe(0);
  });

  it('truncates and clamps age; non-finite is 0', () => {
    expect(normalizePawAge(40.9)).toBe(40);
    expect(normalizePawAge(-3)).toBe(0);
    expect(normalizePawAge(200)).toBe(90);
    expect(normalizePawAge(Number.NaN)).toBe(0);
  });
});

describe('pawLens (EDGE_CASES §PAW)', () => {
  it('PAW1: 40 × $100,000 ÷ 10 = $400,000 near', () => {
    const row = classic();
    expect(row.expectedNetWorthCents).toBe(40_000_000);
    expect(row.band).toBe('near');
    expect(row.idle).toBe(false);
    expect(row.noIncome).toBe(false);
  });

  it('PAW1b/c: 2× is above; 0.25× is under', () => {
    expect(classic({ netWorthCents: 80_000_000 }).band).toBe('above');
    expect(classic({ netWorthCents: 10_000_000 }).band).toBe('under');
  });

  it('PAW2: 105 / 10 = 10.5 → 11¢', () => {
    expect(
      pawLens({
        ageYears: 1,
        annualIncomeCents: 105,
        netWorthCents: 11,
        incomeWindowMonths: 1,
      }).expectedNetWorthCents,
    ).toBe(11);
  });

  it('PAW3: exactly −10% is near; one cent further is under', () => {
    expect(PAW_NEAR_BPS).toBe(1000);
    expect(classic({ netWorthCents: 36_000_000 }).band).toBe('near');
    expect(classic({ netWorthCents: 35_999_999 }).band).toBe('under');
    expect(classic({ netWorthCents: 44_000_000 }).band).toBe('near');
    expect(classic({ netWorthCents: 44_000_001 }).band).toBe('above');
  });

  it('PAW4: age 0 is idle — no expected figure', () => {
    const row = classic({ ageYears: 0 });
    expect(row.idle).toBe(true);
    expect(row.expectedNetWorthCents).toBeNull();
    expect(row.band).toBeNull();
  });

  it('PAW5: $0 income is noIncome — no expected figure', () => {
    const row = classic({ annualIncomeCents: 0 });
    expect(row.noIncome).toBe(true);
    expect(row.expectedNetWorthCents).toBeNull();
    expect(row.band).toBeNull();
  });

  it('PAW6: negative net worth stays negative and is under', () => {
    const row = classic({ netWorthCents: -500_000 });
    expect(row.netWorthCents).toBe(-500_000);
    expect(row.expectedNetWorthCents).toBe(40_000_000);
    expect(row.band).toBe('under');
  });

  it('PAW7: expected rounding to $0.00 has no band', () => {
    const row = pawLens({
      ageYears: 1,
      annualIncomeCents: 4,
      netWorthCents: 100_000,
      incomeWindowMonths: 1,
    });
    expect(row.expectedNetWorthCents).toBe(0);
    expect(row.band).toBeNull();
    expect(pawBand(100_000, 0)).toBeNull();
  });
});

describe('PAW copy honesty', () => {
  it('test_regression__paw_lens_zero_age_is_idle_not_a_savings_claim', () => {
    const idle = COACH_COPY.pawLensIdle(classic({ ageYears: 0 }));
    expect(idle).toMatch(/age × yearly income ÷ 10/);
    expect(idle).toMatch(/not a grade/);
    expect(idle).not.toMatch(/short of|above that number|under-accumul|PAW|UAW/i);
    expect(idle).not.toMatch(/this card|\bbelow\b/i);
    expect(COACH_COPY.pawLens(classic({ ageYears: 0 }))).toBeNull();
  });

  it('test_regression__paw_lens_names_only_this_income_and_does_not_nudge', () => {
    const text = COACH_COPY.pawLens(classic())!;
    expect(text).toContain('$400,000.00');
    expect(text).toContain('age 40');
    expect(text).toMatch(/same income the FI card uses/);
    expect(text).toMatch(/not a recommendation to save more or spend more/);
    expect(text).not.toMatch(/\bPAW\b|\bUAW\b|prodigious|under-accumul/i);
    expect(text).not.toMatch(/this card|\bbelow\b/i);
  });

  it('test_regression__paw_lens_does_not_block_accounts_list_on_coach', () => {
    const src = readFileSync('src/app/(app)/accounts/page.tsx', 'utf8');
    expect(src).not.toMatch(/getCoachData/);
    expect(src).not.toMatch(/PawLensCard/);
    expect(src).not.toMatch(/paw-lens/);
  });

  it('test_regression__paw_lens_names_fi_card_income_window', () => {
    const empty = COACH_COPY.pawLensEmpty(6);
    expect(empty).toMatch(/last 6 complete months/);
    expect(empty).toMatch(/same income the FI card uses/);
    expect(empty).not.toMatch(/this card|\bbelow\b/i);
    const idle = COACH_COPY.pawLensIdle(
      pawLens({
        ageYears: 0,
        annualIncomeCents: cents(6_000_000),
        netWorthCents: 10_000_000,
        incomeWindowMonths: 6,
      }),
    );
    expect(idle).toContain('$60,000.00');
    expect(idle).toMatch(/last 6 complete months/);
  });
});
