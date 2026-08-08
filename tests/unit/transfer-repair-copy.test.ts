/**
 * H.7b — the repair card's sentences (critic-cycled). Each is a claim about
 * money or about what the app did/will do; a claim that can be wrong is a
 * claim that needs a test (the plaid-update-copy rule). The cycle-1 critics
 * executed three false sentences out of the first cut — the wrong-zero
 * headline, the mispluralized out-of-scope tail, and "1 of it is categorised
 * as income" — so these lock the exact renders.
 */
import { describe, expect, it } from 'vitest';

import {
  moneyBothWays,
  repairAllSkippedNote,
  repairApplyLabel,
  repairCashAdvanceCaution,
  repairClaim,
  repairExplainer,
  repairLastRunLine,
  repairNothingLine,
  repairOutOfScopeNote,
  repairShowRowsLabel,
  repairUndoneLine,
} from '@/components/settings/transfer-repair-copy';

describe('H.7b copy: the money claim', () => {
  it('names both directions when both return, in dollars', () => {
    const s = repairClaim({
      clearCount: 53,
      inflowCents: 21_411_05,
      outflowCents: 1_812_81_51,
      incomeCategorisedCount: 4,
    });
    expect(s).toContain('53 transactions are being left out of your totals');
    expect(s).toContain("today's check doesn't support");
    expect(s).toContain('$181,281.51 of money out');
    expect(s).toContain('$21,411.05 of money in');
    expect(s).toContain('4 of them are categorised as income.');
  });

  it('elides a zero direction rather than claiming $0.00 of it', () => {
    const s = repairClaim({ clearCount: 1, inflowCents: 0, outflowCents: 700, incomeCategorisedCount: 0 });
    expect(s).toContain('1 transaction is being left out');
    expect(s).toContain('$7.00 of money out');
    expect(s).not.toContain('money in');
    expect(s).not.toContain('income');
  });

  it('the single income row reads as a sentence, not "1 of it" (critic P2-5)', () => {
    const s = repairClaim({ clearCount: 1, inflowCents: 500, outflowCents: 0, incomeCategorisedCount: 1 });
    expect(s).toContain('It is categorised as income.');
    expect(s).not.toContain('1 of it');
  });

  it('moneyBothWays refuses an amount claim when both sides are zero', () => {
    expect(moneyBothWays(0, 0)).toBeNull();
  });

  it('the cash-advance caution names the class the check cannot see and the remedy (critic P1-1)', () => {
    const s = repairCashAdvanceCaution();
    expect(s).toContain('cash advance or balance transfer');
    expect(s).toContain('really is a transfer');
    expect(s).toContain('file that transaction as Transfer instead');
    expect(s).toContain('count the same money twice');
  });
});

describe('H.7b copy: a zero is a claim and names which zero (three zeros, critic P1-2)', () => {
  it('no marks at all → "nothing to check", never "nothing needs repair"', () => {
    expect(repairNothingLine({ flaggedCount: 0, declinedOutOfScopeCount: 0 })).toContain(
      'No transactions are marked as transfers yet',
    );
  });
  it('declined marks exist outside the tool\'s scope → the headline claims only what the tool covers', () => {
    const s = repairNothingLine({ flaggedCount: 5, declinedOutOfScopeCount: 2 });
    expect(s).toContain('Nothing this tool covers needs repair');
    expect(s).toContain('marks it doesn’t cover');
    // The false version the critic executed: an unscoped "nothing needs repair".
    expect(s).not.toMatch(/^Nothing needs repair/);
  });
  it('marks exist and every one checks out → the unscoped all-clear', () => {
    const s = repairNothingLine({ flaggedCount: 12, declinedOutOfScopeCount: 0 });
    expect(s).toContain('Nothing needs repair');
    expect(s).toContain('backed by today’s check');
  });
});

describe('H.7b copy: non-coverage is disclosed, not implied away', () => {
  it('is silent when everything declined is in scope', () => {
    expect(repairOutOfScopeNote(0)).toBeNull();
  });
  it('pluralizes its whole spine, tail included (critic P2-4)', () => {
    const many = repairOutOfScopeNote(3)!;
    expect(many).toContain('3 marked rows');
    expect(many).toContain('are not covered here');
    expect(many).toContain('stay exactly as they are');
    expect(many).not.toContain('stays exactly as it is');
    const one = repairOutOfScopeNote(1)!;
    expect(one).toContain('1 marked row');
    expect(one).toContain('stays exactly as it is');
  });
  it('names the non-USD and reader-excluded classes the money claim excludes (critic P1-1)', () => {
    const s = repairOutOfScopeNote(2)!;
    expect(s).toContain('non-USD');
    expect(s).toContain('excluded by you');
    expect(s).toContain('pending');
  });
});

describe('H.7b copy: controls and the recorded run', () => {
  it('the apply button and the rows toggle carry the count they act on', () => {
    expect(repairApplyLabel(2)).toBe('Restore 2 transactions to my totals');
    expect(repairApplyLabel(1)).toBe('Restore 1 transaction to my totals');
    expect(repairShowRowsLabel(1)).toBe('Show the transaction');
    expect(repairShowRowsLabel(3)).toBe('Show the 3 transactions');
  });
  it('the confirmation line makes NO calendar-day claim (critic P1-3)', () => {
    const s = repairLastRunLine({ clearedCount: 2, skippedCount: 0, inflowCents: 500, outflowCents: 700 });
    expect(s).toContain('Most recent repair: restored 2 transactions');
    expect(s).toContain('$7.00 of money out and $5.00 of money in');
    expect(s).not.toMatch(/\b20\d\d\b/); // no year, no date
  });
  it('a partial apply is disclosed, never silently narrowed (critic P2-6)', () => {
    const s = repairLastRunLine({ clearedCount: 2, skippedCount: 1, inflowCents: 0, outflowCents: 700 });
    expect(s).toContain('restored 2 of the 3 it named');
    expect(s).toContain('1 was re-decided while it ran and kept your change.');
  });
  it('an apply that cleared nothing states its outcome — the click cannot end in silence', () => {
    const s = repairAllSkippedNote();
    expect(s).toContain('Nothing was changed');
    expect(s).toContain('re-decided');
  });
  it('the undone line says the reader\'s in-between changes were kept, with no day claim', () => {
    const s = repairUndoneLine({ clearedCount: 2 });
    expect(s).toContain('was undone');
    expect(s).toContain('kept your change');
    expect(s).not.toMatch(/\b20\d\d\b/);
  });
  it('the explainer states the mechanism and that nothing changes without the user', () => {
    const s = repairExplainer();
    expect(s).toContain('left out of income and spending');
    expect(s).toContain('unrelated payment of the same amount');
    expect(s).toContain('changes nothing until you say so');
  });
});
