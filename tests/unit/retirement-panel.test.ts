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
    // The first year bar (age === currentAge) is seeded with the reader's real
    // investment balances: "…is a projection — no transactions or holdings make
    // it up" would be exactly wrong for a figure their accounts actually make up.
    const r = retirementCurrentPortfolioRefusal(cents(14200000), base, {
      rawSumCents: 14200000,
      hasFrozenFeed: false,
    });
    expect(r.emptyCopy).toBe(
      'The $142,000.00 is your current portfolio — the combined balance of your investment accounts today, not a projection.',
    );
    expect(r.basis.length).toBeGreaterThanOrEqual(2);
    expect(r.basis[0]).toBe(retirementAssumptionsSentence(base));
    expect(r.basis[1]).toContain('actual starting figure');
  });

  /**
   * O.20d re-review (Fable critic, fresh context) — three P1s, all the same
   * failure: the sentence asserted more than the inputs supported.
   */
  describe('re-review: the sentence may not out-claim its inputs', () => {
    it('F2 — a floored $0.00 is never called the balance of the accounts (a margin balance)', () => {
      // One INVESTMENT account carrying a −$5,000.00 margin balance.
      // `buildRetirementInputs` floors the projection's start at 0; the OLD copy
      // printed "The $0.00 is … the live balance of your investment accounts
      // today", wrong by $5,000.00 and in the flattering direction.
      const r = retirementCurrentPortfolioRefusal(cents(0), base, {
        rawSumCents: -500000,
        hasFrozenFeed: false,
      });
      expect(r.emptyCopy).toBe(
        'Your investment accounts total -$5,000.00 today — a negative balance. ' +
          'The projection starts from $0.00 instead, because a negative balance can’t be compounded forward.',
      );
      // The defect in one assertion: the clamped figure is never described as
      // what the accounts hold.
      expect(r.emptyCopy).not.toContain('The $0.00 is your current portfolio');
    });

    it('F2 — a genuinely empty portfolio says there is nothing to start from, not "$0.00 is your portfolio"', () => {
      const r = retirementCurrentPortfolioRefusal(cents(0), base, {
        rawSumCents: 0,
        hasFrozenFeed: false,
      });
      expect(r.emptyCopy).toBe(
        'The projection starts from $0.00 — there’s no investment balance to start it from yet.',
      );
      expect(r.emptyCopy).not.toContain('current portfolio');
    });

    it('F1 — a stopped feed drops the word "today", which the card\'s frozen note denies', () => {
      const r = retirementCurrentPortfolioRefusal(cents(14200000), base, {
        rawSumCents: 14200000,
        hasFrozenFeed: true,
      });
      expect(r.emptyCopy).toBe(
        'The $142,000.00 is your current portfolio — the combined balance of your investment accounts as we last have it, not a projection.',
      );
      expect(r.emptyCopy).not.toContain('today');
      // The negative branch carries the same qualifier — one rule, both states.
      const neg = retirementCurrentPortfolioRefusal(cents(0), base, {
        rawSumCents: -500000,
        hasFrozenFeed: true,
      });
      expect(neg.emptyCopy).toContain('as we last have it');
      expect(neg.emptyCopy).not.toContain('today');
    });

    it('F3 — the basis names the OTHER portfolio figure on the same page instead of asserting it away', () => {
      // This bar totals ACCOUNT BALANCES; /investments headlines "Portfolio
      // value", which totals what the HOLDINGS mark to. They differ whenever
      // positions mark away from the cash balance — and on the production demo
      // today the page renders "no investment holdings" directly beneath this
      // panel's figure. The old docstring claimed the two were the same number.
      const r = retirementCurrentPortfolioRefusal(cents(14200000), base, {
        rawSumCents: 14200000,
        hasFrozenFeed: false,
      });
      const reconciliation = r.basis.find((s) => s.includes('Portfolio value'));
      expect(reconciliation).toBeDefined();
      expect(reconciliation).toContain('balances your investment accounts report');
      expect(reconciliation).toContain('so the two can differ');
    });

    it('every branch keeps the assumptions sentence first — one definition, all states', () => {
      for (const facts of [
        { rawSumCents: 14200000, hasFrozenFeed: false },
        { rawSumCents: 14200000, hasFrozenFeed: true },
        { rawSumCents: 0, hasFrozenFeed: false },
        { rawSumCents: -500000, hasFrozenFeed: false },
      ]) {
        const r = retirementCurrentPortfolioRefusal(cents(Math.max(0, facts.rawSumCents)), base, facts);
        expect(r.basis[0]).toBe(retirementAssumptionsSentence(base));
        // No branch may claim rows exist — this panel is a refusal in all states.
        expect(r.emptyCopy).not.toContain('transactions');
      }
    });
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
