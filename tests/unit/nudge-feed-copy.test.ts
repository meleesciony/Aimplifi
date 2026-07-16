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
import { proposalCopy, whyInputs } from '@/components/dashboard/today-feed-copy';

function prop(o: Partial<Proposal> & { kind: ProposalKind; tier: ProposalTier }): Proposal {
  return {
    key: 'k',
    dismissKey: 'k',
    subjectKey: `nudge:${o.kind}` as Proposal['subjectKey'],
    sortDate: null,
    daysUntil: null,
    centsAtStake: cents(0) as Cents,
    autopayCents: cents(0) as Cents,
    isEstimated: false,
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

  it('no branch addresses the reader as the payer ("you pay"/"your payment")', () => {
    const kinds: Array<{ kind: ProposalKind; tier: ProposalTier }> = [
      { kind: 'payment_due', tier: 'critical' },
      { kind: 'payment_due', tier: 'handled' },
      { kind: 'cash_needed_shortfall', tier: 'critical' },
      { kind: 'cash_flow_dip', tier: 'critical' },
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
  it('lists the stake, date, days-out, and an honest estimate qualifier', () => {
    const w = whyInputs(prop({ kind: 'payment_due', tier: 'action', centsAtStake: cents(50000) as Cents, sortDate: isoDate('2026-06-20'), daysUntil: 10, isEstimated: true }));
    expect(w).toContain('$500.00 at stake');
    expect(w).toContain('10 days out');
    // "based on an estimate" — never "not yet a final figure" (false for heuristic saving estimates).
    expect(w).toContain('based on an estimate');
    expect(w).not.toContain('final figure');
  });
});
