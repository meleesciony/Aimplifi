/**
 * H.7b — the repair card's sentences. Each is a claim about money or about
 * what the app did/will do; a claim that can be wrong is a claim that needs a
 * test (the plaid-update-copy rule).
 */
import { describe, expect, it } from 'vitest';

import {
  moneyBothWays,
  repairApplyLabel,
  repairClaim,
  repairExplainer,
  repairLastRunLine,
  repairNothingLine,
  repairOutOfScopeNote,
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

  it('moneyBothWays refuses an amount claim when both sides are zero', () => {
    expect(moneyBothWays(0, 0)).toBeNull();
  });
});

describe('H.7b copy: a zero is a claim and names which zero', () => {
  it('no marks at all → "nothing to check", never "nothing needs repair"', () => {
    expect(repairNothingLine({ flaggedCount: 0 })).toContain('No transactions are marked as transfers yet');
  });
  it('marks exist and all check out → the precise claim, scoped to settled rows', () => {
    const s = repairNothingLine({ flaggedCount: 12 });
    expect(s).toContain('Nothing needs repair');
    expect(s).toContain('no settled transaction');
  });
});

describe('H.7b copy: non-coverage is disclosed, not implied away', () => {
  it('is silent when everything declined is in scope', () => {
    expect(repairOutOfScopeNote(0)).toBeNull();
  });
  it('names the count and that those rows stay as they are', () => {
    const s = repairOutOfScopeNote(3)!;
    expect(s).toContain('3 marked rows');
    expect(s).toContain('not covered here');
    expect(s).toContain('stays exactly as it is');
  });
});

describe('H.7b copy: controls and the recorded run', () => {
  it('the apply button carries the count it acts on', () => {
    expect(repairApplyLabel(2)).toBe('Restore 2 transactions to my totals');
    expect(repairApplyLabel(1)).toBe('Restore 1 transaction to my totals');
  });
  it('the last-run line restates what was restored, dated', () => {
    const s = repairLastRunLine({ dateLabel: 'Aug 8, 2026', clearedCount: 2, inflowCents: 500, outflowCents: 700 });
    expect(s).toContain('Restored 2 transactions on Aug 8, 2026');
    expect(s).toContain('$7.00 of money out and $5.00 of money in');
  });
  it('the undone line says the reader’s in-between changes were kept', () => {
    const s = repairUndoneLine({ dateLabel: 'Aug 8, 2026', clearedCount: 2 });
    expect(s).toContain('was undone');
    expect(s).toContain('kept your change');
  });
  it('the explainer states the mechanism and that nothing changes without the user', () => {
    const s = repairExplainer();
    expect(s).toContain('left out of income and spending');
    expect(s).toContain('unrelated payment of the same amount');
    expect(s).toContain('changes nothing until you say so');
  });
});
