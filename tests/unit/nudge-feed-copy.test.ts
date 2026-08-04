/**
 * "Today" feed display copy (NUDGE_PLAN slice 2, cycle-2/3 critic locks). Pins the
 * money-honesty surface directly: each kind labels centsAtStake with its correct
 * semantic, the partial-autopay split is shown (never summed into a false total), and
 * every estimate discloses INLINE. A regression to summing or mislabeling fails here,
 * not only in an e2e that happens to seed the right shape (cycle-2 P2-2).
 */
import { describe, expect, it } from 'vitest';
import { cents, type Cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { Proposal, ProposalKind, ProposalTier } from '@/lib/engine/nudge/types';
import { proposalCopy, tierRule, whyInputs } from '@/components/dashboard/today-feed-copy';

function prop(o: Partial<Proposal> & { kind: ProposalKind; tier: ProposalTier }): Proposal {
  return {
    key: 'k',
    dismissKey: 'k',
    subjectKey: `nudge:${o.kind}` as Proposal['subjectKey'],
    sortDate: null,
    daysUntil: null,
    centsAtStake: cents(0) as Cents,
    autopayCents: cents(0) as Cents,
    merchant: null,
    typicalCents: null,
    typicalCount: null,
    cadence: null,
    runwayMonths: null,
    runwayWindowMonths: null,
    isEstimated: false,
    fundingFrozen: null,
    dismissed: false,
    ...o,
  };
}

describe('proposalCopy — money-honesty per kind', () => {
  it('payment_due (no autopay): shows the amount "to pay", never "Card"', () => {
    const c = proposalCopy(prop({ kind: 'payment_due', tier: 'critical', centsAtStake: cents(60000) as Cents, autopayCents: cents(0) as Cents, sortDate: isoDate('2026-06-12'), daysUntil: 2 }));
    expect(c.title).toBe('Payment due');
    expect(c.detail).toContain('$600.00 to pay');
    expect(c.detail).not.toContain('autopay covers');
    expect(c.detail).not.toContain('Card');
  });

  it('payment_due (partial autopay): shows the split, never the summed total', () => {
    // $600 statement, autopay $100 → $500 to pay. Must show both parts, never "$600".
    const c = proposalCopy(prop({ kind: 'payment_due', tier: 'critical', centsAtStake: cents(50000) as Cents, autopayCents: cents(10000) as Cents, sortDate: isoDate('2026-06-12'), daysUntil: 2 }));
    expect(c.detail).toContain('$500.00 to pay');
    expect(c.detail).toContain('autopay covers $100.00');
    expect(c.detail).not.toContain('$600.00'); // the total is never computed/shown
  });

  it('payment_due (estimated): discloses the estimate inline', () => {
    const c = proposalCopy(prop({ kind: 'payment_due', tier: 'action', centsAtStake: cents(20000) as Cents, isEstimated: true, sortDate: isoDate('2026-06-25'), daysUntil: 15 }));
    expect(c.detail).toContain('(estimated statement)');
  });

  it('payment_due (handled/autopay): quiet, funds-present caveat, owner-neutral', () => {
    const c = proposalCopy(prop({ kind: 'payment_due', tier: 'handled', centsAtStake: cents(90000) as Cents, sortDate: isoDate('2026-06-11') }));
    expect(c.title).toBe('Payment scheduled (autopay)');
    expect(c.detail).toContain('autopay moves it automatically');
    expect(c.detail).not.toMatch(/\byou\b/i);
  });

  it('cash_needed_shortfall: estimate marker is INLINE, not only in the disclosure', () => {
    const real = proposalCopy(prop({ kind: 'cash_needed_shortfall', tier: 'critical', centsAtStake: cents(141233) as Cents, sortDate: isoDate('2026-06-15') }));
    expect(real.detail).toContain('About $1,412.33 short');
    expect(real.detail).not.toContain('(estimated)');
    const est = proposalCopy(prop({ kind: 'cash_needed_shortfall', tier: 'critical', centsAtStake: cents(200000) as Cents, isEstimated: true, sortDate: isoDate('2026-06-15') }));
    expect(est.detail).toContain('(estimated)');
  });

  it('cash_flow_dip: transfer figure + inline estimate marker when estimate-driven', () => {
    const est = proposalCopy(prop({ kind: 'cash_flow_dip', tier: 'critical', centsAtStake: cents(30000) as Cents, isEstimated: true, sortDate: isoDate('2026-06-14'), daysUntil: 4 }));
    expect(est.detail).toContain('transfer of about $300.00');
    expect(est.detail).toContain('(estimated)');
  });

  it('price-increase: the figure is the INCREASE ("Up $X"), never "Now $X"', () => {
    const c = proposalCopy(prop({ kind: 'price-increase', tier: 'opportunity', centsAtStake: cents(250) as Cents }));
    expect(c.detail).toContain('Up $2.50/mo');
    expect(c.detail).not.toContain('Now $');
  });

  it('unused-subscription: the figure is the monthly cost', () => {
    const c = proposalCopy(prop({ kind: 'unused-subscription', tier: 'opportunity', centsAtStake: cents(4000) as Cents }));
    expect(c.detail).toContain('$40.00/mo');
  });

  it('insurance-reshop / negotiable-bill: figure is a SAVING, disclosed as estimated', () => {
    const ins = proposalCopy(prop({ kind: 'insurance-reshop', tier: 'opportunity', centsAtStake: cents(1350) as Cents, isEstimated: true }));
    expect(ins.detail).toContain('could save around $13.50/mo (estimated)');
    const neg = proposalCopy(prop({ kind: 'negotiable-bill', tier: 'opportunity', centsAtStake: cents(2000) as Cents, isEstimated: true }));
    expect(neg.detail).toContain('could save around $20.00/mo (estimated)');
  });

  it('unusual_charge: the figure is the CHARGE; the median comparison discloses its basis inline', () => {
    const c = proposalCopy(
      prop({
        kind: 'unusual_charge',
        tier: 'action',
        centsAtStake: cents(21436) as Cents,
        merchant: 'Blue Bottle Coffee',
        typicalCents: cents(750) as Cents,
        typicalCount: 14,
        sortDate: isoDate('2026-06-02'),
      }),
    );
    expect(c.title).toBe('Unusual charge worth a look');
    expect(c.detail).toContain('$214.36 at Blue Bottle Coffee');
    // The comparison figure is labeled with its basis (median of N) — never a bare claim.
    expect(c.detail).toContain('typical $7.50 there (median of 14 charges)');
    // No-shame guardrail: legitimate outcome is offered, no spending judgment.
    expect(c.detail).toContain('If it’s expected, dismiss this.');
    expect(c.detail).not.toMatch(/overspen|too much|shouldn/i);
  });

  it('unusual_charge: degrades gracefully when display context is absent (no dangling comparison)', () => {
    const c = proposalCopy(prop({ kind: 'unusual_charge', tier: 'action', centsAtStake: cents(21436) as Cents }));
    expect(c.detail).toContain('$214.36');
    expect(c.detail).not.toContain('median');
    expect(c.detail).not.toContain(' at ');
  });

  it('income_pause: the figure is the deposit that DIDN’T arrive; both bases disclosed inline', () => {
    const c = proposalCopy(
      prop({
        kind: 'income_pause',
        tier: 'action',
        centsAtStake: cents(38000) as Cents,
        merchant: 'Stripe Payout',
        typicalCount: 4,
        cadence: 'MONTHLY',
        runwayMonths: 4.4,
        runwayWindowMonths: 6,
        sortDate: isoDate('2026-05-10'),
      }),
    );
    expect(c.title).toBe('A regular deposit seems paused');
    expect(c.detail).toContain('$380.00 from Stripe Payout usually arrives monthly');
    expect(c.detail).toContain('expected around Sun, May 10');
    // The cadence claim is labeled with its basis — never a bare pattern claim.
    expect(c.detail).toContain('(based on 4 deposits)');
    // The runway figure is "about" + names its own formula inline (coaching guardrail).
    expect(c.detail).toContain('covers about 4.4 months of typical spending (cash ÷ your 6-month average expenses)');
    // No-shame: a planned pause is the offered outcome, no judgment or alarm words.
    expect(c.detail).toContain('If this is a pause you expected, dismiss this.');
    expect(c.detail).not.toMatch(/lost your|fired|emergency|crisis|behind/i);
    // Never "at stake" / "spent" — the money did not move.
    expect(c.detail).not.toMatch(/at stake|spent/i);
  });

  it('income_pause: cadence words cover all three cadences', () => {
    const base = { kind: 'income_pause' as ProposalKind, tier: 'action' as ProposalTier, centsAtStake: cents(38000) as Cents, merchant: 'M' };
    expect(proposalCopy(prop({ ...base, cadence: 'WEEKLY' })).detail).toContain('usually arrives weekly');
    expect(proposalCopy(prop({ ...base, cadence: 'BIWEEKLY' })).detail).toContain('usually arrives every two weeks');
    expect(proposalCopy(prop({ ...base, cadence: 'MONTHLY' })).detail).toContain('usually arrives monthly');
  });

  it('income_pause (confirmed/handled): discloses the exclusion, the auto-return rule, and the undo', () => {
    const c = proposalCopy(
      prop({ kind: 'income_pause', tier: 'handled', centsAtStake: cents(38000) as Cents, merchant: 'Stripe Payout', cadence: 'MONTHLY', sortDate: isoDate('2026-05-10') }),
    );
    expect(c.title).toBe('Income marked paused');
    expect(c.detail).toContain('$380.00 from Stripe Payout');
    // The mutation is stated plainly: projections stop counting it…
    expect(c.detail).toContain('cash projections don’t count it');
    // …the exit is automatic and disclosed…
    expect(c.detail).toContain('returns automatically when a new deposit arrives');
    // …and the undo is offered.
    expect(c.detail).toContain('Undo');
  });

  it('#251 critic F2: the HANDLED income_pause rule line never claims autopay; real autopay rows keep theirs', () => {
    const pauseRule = tierRule(prop({ kind: 'income_pause', tier: 'handled', centsAtStake: cents(38000) as Cents }));
    expect(pauseRule).not.toMatch(/autopay/i);
    expect(pauseRule).toContain('You confirmed this income is paused');
    expect(pauseRule).toContain('Undo');
    // The generic HANDLED rule (true for autopay payment rows) is unchanged.
    const autopayRule = tierRule(prop({ kind: 'payment_due', tier: 'handled', centsAtStake: cents(90000) as Cents }));
    expect(autopayRule).toContain('Autopay covers this');
    // ACTION income_pause keeps the generic decision rule.
    expect(tierRule(prop({ kind: 'income_pause', tier: 'action', centsAtStake: cents(38000) as Cents }))).toContain('needs a decision');
  });

  it('income_pause: no runway figure → no runway sentence (never a dangling or ∞ claim)', () => {
    const c = proposalCopy(
      prop({ kind: 'income_pause', tier: 'action', centsAtStake: cents(38000) as Cents, merchant: 'Stripe Payout', cadence: 'MONTHLY', typicalCount: 4, sortDate: isoDate('2026-05-10') }),
    );
    expect(c.detail).not.toContain('cash on hand');
    expect(c.detail).not.toContain('Infinity');
  });

  it('no branch addresses the reader as the payer ("you pay"/"your payment")', () => {
    const kinds: Array<{ kind: ProposalKind; tier: ProposalTier }> = [
      { kind: 'payment_due', tier: 'critical' },
      { kind: 'payment_due', tier: 'handled' },
      { kind: 'cash_needed_shortfall', tier: 'critical' },
      { kind: 'cash_flow_dip', tier: 'critical' },
      { kind: 'unusual_charge', tier: 'action' },
      { kind: 'income_pause', tier: 'action' },
      { kind: 'price-increase', tier: 'opportunity' },
      { kind: 'unused-subscription', tier: 'opportunity' },
      { kind: 'insurance-reshop', tier: 'opportunity' },
      { kind: 'negotiable-bill', tier: 'opportunity' },
    ];
    for (const k of kinds) {
      const c = proposalCopy(prop({ ...k, centsAtStake: cents(1000) as Cents }));
      expect(c.detail, `${k.kind}/${k.tier}`).not.toMatch(/you pay|your payment/i);
    }
  });
});

describe('whyInputs — verbatim inputs, honest estimate wording', () => {
  it('unusual_charge: the disclosure says "a $X charge", never "$X at stake" (already spent)', () => {
    const w = whyInputs(prop({ kind: 'unusual_charge', tier: 'action', centsAtStake: cents(21436) as Cents, sortDate: isoDate('2026-06-02') }));
    expect(w).toContain('a $214.36 charge');
    expect(w).not.toContain('at stake');
  });

  it('income_pause: the disclosure says "an expected $X deposit", never "$X at stake" (money that didn’t arrive)', () => {
    const w = whyInputs(prop({ kind: 'income_pause', tier: 'action', centsAtStake: cents(38000) as Cents, sortDate: isoDate('2026-05-10') }));
    expect(w).toContain('an expected $380.00 deposit');
    expect(w).toContain('dated Sun, May 10');
    expect(w).not.toContain('at stake');
  });

  it('lists the stake, date, days-out, and an honest estimate qualifier', () => {
    const w = whyInputs(prop({ kind: 'payment_due', tier: 'action', centsAtStake: cents(50000) as Cents, sortDate: isoDate('2026-06-20'), daysUntil: 10, isEstimated: true }));
    expect(w).toContain('$500.00 at stake');
    expect(w).toContain('10 days out');
    // "based on an estimate" — never "not yet a final figure" (false for heuristic saving estimates).
    expect(w).toContain('based on an estimate');
    expect(w).not.toContain('final figure');
  });
});
