/**
 * The eligible-transfer-source rule has ONE home (C.7, CALC_AUDIT P0-2).
 *
 * `radar.ts` applied four guards before naming an account in a transfer
 * instruction; the dashboard hero derived its own list with none of them
 * (`type === 'SAVINGS'`, sorted by balance) and printed the winner inside
 * "Transfer $X from <name> ($Y available)" — on the same page, from the same
 * account array. A frozen balance is stale and reads HIGH, and because sources
 * sort by size it was preferentially chosen: the reader is told to move money
 * out of an account whose real balance nobody has seen since the feed dropped.
 *
 * These lock the shared selector both callers now obtain the rule from. Each
 * guard gets a case where the excluded account would WIN the sort if the guard
 * were missing — an exclusion test whose fixture cannot beat the survivor proves
 * nothing about ordering.
 */
import { describe, it, expect } from 'vitest';
import { eligibleTransferSources, TRANSFER_SOURCE_TYPES } from '@/lib/engine/radar/radar';

type Acct = {
  id: string;
  name: string;
  type: string;
  currentBalanceCents: number;
  feedDroppedAt: string | null;
};

const acct = (over: Partial<Acct> & { id: string }): Acct => ({
  name: `Account ${over.id}`,
  type: 'SAVINGS',
  currentBalanceCents: 100_00,
  feedDroppedAt: null,
  ...over,
});

const LIVE = acct({ id: 'live', name: 'Everyday Savings', currentBalanceCents: 250_00 });

describe('eligibleTransferSources', () => {
  it('never names a frozen account, even when its stale balance is the largest', () => {
    // The whole defect in one fixture: the frozen account outranks the live one
    // 40x, so a missing guard is a sort win, not a tie.
    const frozen = acct({
      id: 'frozen',
      name: 'Rainy Day Savings',
      currentBalanceCents: 10_000_00,
      feedDroppedAt: '2026-07-19',
    });
    const out = eligibleTransferSources([frozen, LIVE], 'chk');
    expect(out.map((a) => a.id)).toEqual(['live']);
  });

  it('never names the payment account itself, even when it holds the most', () => {
    const payment = acct({ id: 'chk', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 900_00 });
    const out = eligibleTransferSources([payment, LIVE], 'chk');
    expect(out.map((a) => a.id)).toEqual(['live']);
  });

  it('never names an ineligible type, even when it holds the most', () => {
    // A brokerage cannot be moved same-day; the radar's adjudicated condition 2.
    const brokerage = acct({ id: 'brk', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 142_000_00 });
    expect(TRANSFER_SOURCE_TYPES.has('INVESTMENT')).toBe(false);
    const out = eligibleTransferSources([brokerage, LIVE], 'chk');
    expect(out.map((a) => a.id)).toEqual(['live']);
  });

  it('never names an account with nothing in it (zero or negative)', () => {
    const empty = acct({ id: 'empty', name: 'Empty Savings', currentBalanceCents: 0 });
    const overdrawn = acct({ id: 'od', name: 'Overdrawn Checking', type: 'CHECKING', currentBalanceCents: -50_00 });
    const out = eligibleTransferSources([empty, overdrawn, LIVE], 'chk');
    expect(out.map((a) => a.id)).toEqual(['live']);
  });

  it('offers checking as well as savings — the guard is the type SET, not "savings"', () => {
    // The dashboard's old local filter was `type === 'SAVINGS'`, so a reader
    // whose only spare money sits in a second checking account was told
    // "(e.g. from savings)" while holding an account that could cover it.
    const otherChecking = acct({ id: 'chk2', name: 'Second Checking', type: 'CHECKING', currentBalanceCents: 400_00 });
    const out = eligibleTransferSources([LIVE, otherChecking], 'chk');
    expect(out.map((a) => a.id)).toEqual(['chk2', 'live']);
  });

  it('orders by balance, then the printed name, then id — a rename cannot silently reorder', () => {
    const a = acct({ id: 'a-id', name: 'Zebra Savings', currentBalanceCents: 500_00 });
    const b = acct({ id: 'b-id', name: 'Alpha Savings', currentBalanceCents: 500_00 });
    const big = acct({ id: 'big', name: 'Big Savings', currentBalanceCents: 900_00 });
    const out = eligibleTransferSources([a, b, big], 'chk');
    expect(out.map((a) => a.id)).toEqual(['big', 'b-id', 'a-id']);
  });

  it('returns an empty list rather than a fallback when nothing qualifies', () => {
    // An honest gap, not a fabricated instruction: the callers render
    // "(e.g. from savings)" / an assumption line, never a guessed account.
    const frozen = acct({ id: 'frozen', currentBalanceCents: 10_000_00, feedDroppedAt: '2026-07-19' });
    expect(eligibleTransferSources([frozen], 'chk')).toEqual([]);
    expect(eligibleTransferSources([], 'chk')).toEqual([]);
  });

  it('does not mutate or reorder the caller’s array', () => {
    const input = [acct({ id: 'small', currentBalanceCents: 1_00 }), LIVE];
    const before = input.map((a) => a.id);
    eligibleTransferSources(input, 'chk');
    expect(input.map((a) => a.id)).toEqual(before);
  });

  it('carries the caller’s own extra fields through, so neither surface re-joins', () => {
    const withExtra = { ...LIVE, mask: '4321' };
    const [first] = eligibleTransferSources([withExtra], 'chk');
    expect(first.mask).toBe('4321');
  });
});
