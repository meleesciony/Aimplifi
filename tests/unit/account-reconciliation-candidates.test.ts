/**
 * Cross-provider reconciliation candidate engine — Wave 4.6 slice 1
 * (docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md §8 direction rule + §10 slice 1).
 *
 * This slice is PURE and ADVISORY: it extends the #192 duplicate detector to emit a
 * DIRECTIONAL candidate (predecessor = stale/disconnected side, successor = live side).
 * No schema, no money mutation, no UI — those are slices 2–5. The invariant locked here
 * is **R3**: two live provider rows for one real account are NEVER auto-linked, and a pair
 * with no single live side has no direction, so no candidate is proposed either way.
 *
 * Abstention cases come first and are the majority (context-carrying features are judged by
 * what they refuse — docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import {
  type ReconciliationAccountCandidate,
  detectDuplicateAccounts,
  detectReconciliationCandidates,
} from '@/lib/engine/account/duplicates';

/** Build a candidate with sensible defaults; `hasLiveConnection` defaults to false (stale). */
function racct(
  p: Partial<ReconciliationAccountCandidate> & { id: string },
): ReconciliationAccountCandidate {
  return {
    provider: 'plaid',
    name: 'Account',
    type: 'CHECKING',
    mask: null,
    currentBalanceCents: 0,
    currency: 'USD',
    hasLiveConnection: false,
    ...p,
  };
}

/** The canonical shape: a disconnected SimpleFIN row and a live Plaid row for the same bank. */
const SIMPLEFIN_DEAD = racct({
  id: 's',
  provider: 'simplefin',
  name: 'CHASE Checking',
  mask: null,
  currentBalanceCents: 48000,
  hasLiveConnection: false,
});
const PLAID_LIVE = racct({
  id: 'p',
  provider: 'plaid',
  name: 'Chase Total Checking',
  mask: '1234',
  currentBalanceCents: 50000,
  hasLiveConnection: true,
});

describe('detectReconciliationCandidates — abstention (R3 + direction)', () => {
  it('R3: two LIVE providers for one real account are NEVER auto-linked', () => {
    const both = [
      { ...SIMPLEFIN_DEAD, hasLiveConnection: true },
      { ...PLAID_LIVE, hasLiveConnection: true },
    ];
    expect(detectReconciliationCandidates(both)).toEqual([]);
    // …but the advisory #192 warning STILL fires for that pair — it is a genuine active duplicate.
    expect(detectDuplicateAccounts(both)).toHaveLength(1);
  });

  it('both DISCONNECTED → no candidate (no live row to continue into)', () => {
    const both = [
      { ...SIMPLEFIN_DEAD, hasLiveConnection: false },
      { ...PLAID_LIVE, hasLiveConnection: false },
    ];
    expect(detectReconciliationCandidates(both)).toEqual([]);
    // advisory still fires — the pair is still a suspected duplicate, just not directionally linkable.
    expect(detectDuplicateAccounts(both)).toHaveLength(1);
  });

  it('a one-live pair with NO #192 signal (different mask/balance/name) → nothing', () => {
    expect(
      detectReconciliationCandidates([
        racct({ id: 'p', provider: 'plaid', name: 'Chase', mask: '1111', currentBalanceCents: 100, hasLiveConnection: true }),
        racct({ id: 's', provider: 'simplefin', name: 'Wells Fargo', mask: '2222', currentBalanceCents: 200 }),
      ]),
    ).toEqual([]);
  });

  it('same-provider pairs are never candidates even with one live / one dead (ingest dedups)', () => {
    expect(
      detectReconciliationCandidates([
        racct({ id: 'a', provider: 'plaid', name: 'Chase', mask: '1234', currentBalanceCents: 5000, hasLiveConnection: true }),
        racct({ id: 'b', provider: 'plaid', name: 'Chase', mask: '1234', currentBalanceCents: 5000, hasLiveConnection: false }),
      ]),
    ).toEqual([]);
  });

  it('demo/seed rows are never proposed even when live and matching', () => {
    expect(
      detectReconciliationCandidates([
        racct({ id: 'd', provider: 'demo', name: 'Chase Checking', mask: '1234', currentBalanceCents: 5000, hasLiveConnection: true }),
        racct({ id: 's', provider: 'simplefin', name: 'Chase Checking', mask: '1234', currentBalanceCents: 5000, hasLiveConnection: false }),
      ]),
    ).toEqual([]);
  });

  it('empty and single-account inputs → []', () => {
    expect(detectReconciliationCandidates([])).toEqual([]);
    expect(detectReconciliationCandidates([PLAID_LIVE])).toEqual([]);
  });
});

describe('detectReconciliationCandidates — direction & payload', () => {
  it('exactly one live side → one candidate, successor=live, predecessor=dead', () => {
    // The canonical case: SimpleFIN carries no mask, so the pair matches on the shared name
    // token → medium confidence, matchSignal 'name'. Direction still resolves from liveness.
    const cands = detectReconciliationCandidates([SIMPLEFIN_DEAD, PLAID_LIVE]);
    expect(cands).toHaveLength(1);
    const [c] = cands;
    expect(c.successor.id).toBe('p'); // Plaid = live = successor
    expect(c.predecessor.id).toBe('s'); // SimpleFIN = disconnected = predecessor
    expect(c.matchSignal).toBe('name');
    expect(c.confidence).toBe('medium');
    expect(c.reasons).toContain('shared name: “chase”');
  });

  it('direction is decided by liveness, NOT input array order', () => {
    const forward = detectReconciliationCandidates([SIMPLEFIN_DEAD, PLAID_LIVE]);
    const reversed = detectReconciliationCandidates([PLAID_LIVE, SIMPLEFIN_DEAD]);
    expect(forward[0].successor.id).toBe('p');
    expect(reversed[0].successor.id).toBe('p'); // still Plaid, regardless of order
    expect(reversed[0].predecessor.id).toBe('s');
  });

  it('a manual (never-synced) row is predecessor-eligible against a live Plaid row', () => {
    // A manual account has no sync connection → not live → the historical predecessor when the
    // user later links the same real account via Plaid. Documents the general liveness rule.
    const cands = detectReconciliationCandidates([
      racct({ id: 'm', provider: 'manual', name: 'Chase', mask: '1234', currentBalanceCents: 30000, hasLiveConnection: false }),
      racct({ id: 'p', provider: 'plaid', name: 'Chase Bank', mask: '1234', currentBalanceCents: 50000, hasLiveConnection: true }),
    ]);
    expect(cands).toHaveLength(1);
    expect(cands[0].successor.id).toBe('p');
    expect(cands[0].predecessor.id).toBe('m');
  });

  it('matchSignal reports the strongest signal that fired: mask > balance > name', () => {
    // mask present (both sides carry last-4) wins even when balance + name also fire → 'mask'.
    // Uses manual+plaid because SimpleFIN carries no mask; both mask-bearing providers is realistic.
    const mask = detectReconciliationCandidates([
      racct({ id: 'p', provider: 'plaid', name: 'Amex', type: 'CREDIT', mask: '1234', currentBalanceCents: 4000, hasLiveConnection: true }),
      racct({ id: 'm', provider: 'manual', name: 'Amex', type: 'CREDIT', mask: '1234', currentBalanceCents: 4000 }),
    ]);
    expect(mask[0].matchSignal).toBe('mask');
    // balance + name, no mask → 'balance'
    const balance = detectReconciliationCandidates([
      racct({ id: 'p', provider: 'plaid', name: 'Wells Fargo', type: 'SAVINGS', mask: null, currentBalanceCents: 21000, hasLiveConnection: true }),
      racct({ id: 's', provider: 'simplefin', name: 'WELLS FARGO', type: 'SAVINGS', mask: null, currentBalanceCents: 21000 }),
    ]);
    expect(balance[0].matchSignal).toBe('balance');
    // name only (different balances, no mask) → 'name'
    const name = detectReconciliationCandidates([
      racct({ id: 'p', provider: 'plaid', name: 'Wells Fargo', currentBalanceCents: 111, hasLiveConnection: true }),
      racct({ id: 's', provider: 'simplefin', name: 'WELLS FARGO', currentBalanceCents: 999 }),
    ]);
    expect(name[0].matchSignal).toBe('name');
  });

  it('orders high-confidence candidates before medium ones', () => {
    const cands = detectReconciliationCandidates([
      // name-only → medium
      racct({ id: 'p1', provider: 'plaid', name: 'Wells Fargo', type: 'CHECKING', currentBalanceCents: 111, hasLiveConnection: true }),
      racct({ id: 's1', provider: 'simplefin', name: 'WELLS FARGO', type: 'CHECKING', currentBalanceCents: 999 }),
      // mask+balance+name → high
      racct({ id: 'p2', provider: 'plaid', name: 'Amex', type: 'CREDIT', mask: '9', currentBalanceCents: 4000, hasLiveConnection: true }),
      racct({ id: 'm2', provider: 'manual', name: 'Amex', type: 'CREDIT', mask: '9', currentBalanceCents: 4000 }),
    ]);
    expect(cands.map((c) => c.confidence)).toEqual(['high', 'medium']);
  });
});
