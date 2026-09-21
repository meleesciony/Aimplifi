/**
 * Home Today display filter (DECISIONS #767): the stage already answers
 * cash-needed. Today ranks what ELSE needs a look. Push still uses the full feed.
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import {
  HOME_STAGE_ELSE_EMPTY,
  omitHomeStageNudges,
} from '@/lib/engine/nudge/home-today';
import type { NudgeFeed, Proposal, ProposalKind } from '@/lib/engine/nudge/types';

function proposal(
  kind: ProposalKind,
  over: Partial<Proposal> = {},
): Proposal {
  return {
    kind,
    tier: kind === 'payment_due' || kind === 'cash_needed_shortfall' ? 'critical' : 'opportunity',
    key: kind,
    dismissKey: kind,
    subjectKey: `nudge:${kind}` as Proposal['subjectKey'],
    sortDate: null,
    daysUntil: null,
    centsAtStake: cents(100),
    autopayCents: cents(0),
    merchant: null,
    accountName: null,
    typicalCents: null,
    typicalCount: null,
    cadence: null,
    runwayMonths: null,
    runwayWindowMonths: null,
    goalNudge: null,
    isEstimated: false,
    fundingFrozen: null,
    dismissed: false,
    ...over,
  };
}

function feedOf(ordered: Proposal[], over: Partial<NudgeFeed> = {}): NudgeFeed {
  return {
    headline: ordered[0] ?? null,
    rest: ordered.slice(1),
    ordered,
    emptyReason: 'Nothing needs you today',
    frozenDueNote: null,
    fundingFrozen: null,
    ...over,
  };
}

describe('omitHomeStageNudges', () => {
  it('test_regression__home_today_drops_payment_due_and_unfrozen_shortfall', () => {
    const unusual = proposal('unusual_charge');
    const out = omitHomeStageNudges(
      feedOf([proposal('payment_due'), proposal('cash_needed_shortfall'), unusual]),
    );
    expect(out.ordered.map((p) => p.kind)).toEqual(['unusual_charge']);
    expect(out.headline?.kind).toBe('unusual_charge');
    expect(out.rest).toEqual([]);
    expect(out.emptyReason).toBe('Nothing needs you today');
  });

  it('test_regression__home_today_keeps_a_frozen_shortfall_hedge', () => {
    const frozen = proposal('cash_needed_shortfall', {
      fundingFrozen: {
        label: 'Everyday Checking',
        frozenSince: '2026-05-20',
        balanceCents: cents(30_000),
      },
    });
    const out = omitHomeStageNudges(feedOf([frozen]));
    expect(out.ordered).toEqual([frozen]);
    expect(out.headline).toBe(frozen);
  });

  it('test_regression__home_today_does_not_claim_all_clear_when_only_the_stage_was_due', () => {
    const out = omitHomeStageNudges(feedOf([proposal('payment_due')]));
    expect(out.ordered).toEqual([]);
    expect(out.headline).toBeNull();
    expect(out.emptyReason).toBe(HOME_STAGE_ELSE_EMPTY);
    expect(out.emptyReason).not.toMatch(/Nothing needs you today/);
  });
});
