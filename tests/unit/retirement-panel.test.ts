import { describe, expect, it } from 'vitest';
import {
  retirementAssumptionsSentence,
  retirementCurrentPortfolioRefusal,
  retirementYearRefusal,
  type RetirementAssumptionInput,
} from '@/lib/engine/investments/retirement';
import { cents } from '@/lib/money';

const base: RetirementAssumptionInput = {
  currentAge: 34,
  retirementAge: 60,
  endAge: 90,
  monthlyContributionCents: cents(50000),
  nominalReturnBps: 700,
  inflationBps: 250,
  returnIsDefault: true,
  annualRetirementSpendingCents: cents(6000000),
};

describe('retirement refusal panel (O.20d)', () => {
  it('the refusal sentence names the figure and age and refuses rows', () => {
    const r = retirementYearRefusal(60, cents(25000000), base);
    expect(r.emptyCopy).toBe(
      '$250,000.00 at age 60 is a projection — no transactions or holdings make it up.',
    );
    // NON-EMPTY basis, first sentence = the assumptions sentence, second = the what-if note.
    expect(r.basis.length).toBeGreaterThanOrEqual(2);
    expect(r.basis[1]).toContain('what-if');
  });

  it('the current-portfolio bar refuses honestly — it is NOT a projection (critic P1-1)', () => {
    // The first year bar (age === currentAge) is seeded with the LIVE portfolio:
    // "…is a projection — no transactions or holdings make it up" would be
    // exactly wrong for the bar the five holdings actually make up.
    const r = retirementCurrentPortfolioRefusal(cents(14200000), base);
    expect(r.emptyCopy).toBe(
      'The $142,000.00 is your current portfolio — the live balance of your investment accounts today, not a projection.',
    );
    expect(r.basis.length).toBeGreaterThanOrEqual(2);
    expect(r.basis[0]).toBe(retirementAssumptionsSentence(base));
    expect(r.basis[1]).toContain('actual starting figure');
  });

  it('the assumption sentence is byte-identical to the card footnote it replaces', () => {
    // NOTE "2.50%": the card's existing `pctFromBps` renders non-integer percents
    // with toFixed(2), so 250bps → "2.50%" — the composer must not "fix" that.
    // Typographic apostrophes throughout — the card footnote it replaces
    // rendered `&rsquo;`, and the e2e suite locks `today’s dollars`.
    expect(retirementAssumptionsSentence(base)).toBe(
      'Assumes you’re 34 today, retiring at 60 and planning through 90; saving $500.00/mo until then; our default 7% expected return less ~2.50% inflation; and today’s $60,000.00/yr of spending — all in today’s dollars.',
    );
  });

  it('a custom return says "your", and a sub-inflation return says no real growth is assumed', () => {
    const custom = retirementAssumptionsSentence({ ...base, returnIsDefault: false });
    expect(custom).toContain('your 7% expected return less ~2.50% inflation');
    const noGrowth = retirementAssumptionsSentence({ ...base, nominalReturnBps: 200 });
    expect(noGrowth).toContain('at or below ~2.50% inflation, so no real growth is assumed');
  });
});
