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
 *
 * TASKS L.9 (2026-07-25): the detector returns a SET — `{ candidates, ambiguous }` — because
 * one stale row that matches SEVERAL live accounts is not offered at all (confirming the wrong
 * one folds the wrong history), and it is not dropped silently either (a filter that discards
 * an unknown must carry it out). The `excludePair` option lets the caller's resolved pairs be
 * seen BEFORE the ambiguity rule runs: dismissing the wrong pair is how the user resolves an
 * ambiguity, and a post-filter would withhold the survivor forever.
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

/** Shorthand: the detector over `accounts`, asserting nothing was withheld as ambiguous. */
function candidatesOf(accounts: ReconciliationAccountCandidate[]) {
  const set = detectReconciliationCandidates(accounts);
  expect(set.ambiguous).toEqual([]);
  return set.candidates;
}

describe('detectReconciliationCandidates — abstention (R3 + direction)', () => {
  it('R3: two LIVE providers for one real account are NEVER auto-linked', () => {
    const both = [
      { ...SIMPLEFIN_DEAD, hasLiveConnection: true },
      { ...PLAID_LIVE, hasLiveConnection: true },
    ];
    expect(detectReconciliationCandidates(both)).toEqual({ candidates: [], ambiguous: [] });
    // …but the advisory #192 warning STILL fires for that pair — it is a genuine active duplicate.
    expect(detectDuplicateAccounts(both)).toHaveLength(1);
  });

  it('both DISCONNECTED → no candidate (no live row to continue into)', () => {
    const both = [
      { ...SIMPLEFIN_DEAD, hasLiveConnection: false },
      { ...PLAID_LIVE, hasLiveConnection: false },
    ];
    expect(detectReconciliationCandidates(both)).toEqual({ candidates: [], ambiguous: [] });
    // advisory still fires — the pair is still a suspected duplicate, just not directionally linkable.
    expect(detectDuplicateAccounts(both)).toHaveLength(1);
  });

  it('a one-live pair with NO #192 signal (different mask/balance/name) → nothing', () => {
    expect(
      detectReconciliationCandidates([
        racct({ id: 'p', provider: 'plaid', name: 'Chase', mask: '1111', currentBalanceCents: 100, hasLiveConnection: true }),
        racct({ id: 's', provider: 'simplefin', name: 'Wells Fargo', mask: '2222', currentBalanceCents: 200 }),
      ]),
    ).toEqual({ candidates: [], ambiguous: [] });
  });

  it('same-provider pairs are never candidates even with one live / one dead (ingest dedups)', () => {
    expect(
      detectReconciliationCandidates([
        racct({ id: 'a', provider: 'plaid', name: 'Chase', mask: '1234', currentBalanceCents: 5000, hasLiveConnection: true }),
        racct({ id: 'b', provider: 'plaid', name: 'Chase', mask: '1234', currentBalanceCents: 5000, hasLiveConnection: false }),
      ]),
    ).toEqual({ candidates: [], ambiguous: [] });
  });

  it('demo/seed rows are never proposed even when live and matching', () => {
    expect(
      detectReconciliationCandidates([
        racct({ id: 'd', provider: 'demo', name: 'Chase Checking', mask: '1234', currentBalanceCents: 5000, hasLiveConnection: true }),
        racct({ id: 's', provider: 'simplefin', name: 'Chase Checking', mask: '1234', currentBalanceCents: 5000, hasLiveConnection: false }),
      ]),
    ).toEqual({ candidates: [], ambiguous: [] });
  });

  it('empty and single-account inputs → empty set', () => {
    expect(detectReconciliationCandidates([])).toEqual({ candidates: [], ambiguous: [] });
    expect(detectReconciliationCandidates([PLAID_LIVE])).toEqual({ candidates: [], ambiguous: [] });
  });
});

describe('detectReconciliationCandidates — direction & payload', () => {
  it('exactly one live side → one candidate, successor=live, predecessor=dead', () => {
    // The canonical case: SimpleFIN carries no mask, so the pair matches on the shared name
    // token → medium confidence, matchSignal 'name'. Direction still resolves from liveness.
    const cands = candidatesOf([SIMPLEFIN_DEAD, PLAID_LIVE]);
    expect(cands).toHaveLength(1);
    const [c] = cands;
    expect(c.successor.id).toBe('p'); // Plaid = live = successor
    expect(c.predecessor.id).toBe('s'); // SimpleFIN = disconnected = predecessor
    expect(c.matchSignal).toBe('name');
    expect(c.confidence).toBe('medium');
    expect(c.reasons).toContain('shared name: “chase”');
  });

  it('direction is decided by liveness, NOT input array order', () => {
    const forward = candidatesOf([SIMPLEFIN_DEAD, PLAID_LIVE]);
    const reversed = candidatesOf([PLAID_LIVE, SIMPLEFIN_DEAD]);
    expect(forward[0].successor.id).toBe('p');
    expect(reversed[0].successor.id).toBe('p'); // still Plaid, regardless of order
    expect(reversed[0].predecessor.id).toBe('s');
  });

  it('a manual (never-synced) row is predecessor-eligible against a live Plaid row', () => {
    // A manual account has no sync connection → not live → the historical predecessor when the
    // user later links the same real account via Plaid. Documents the general liveness rule.
    const cands = candidatesOf([
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
    const mask = candidatesOf([
      racct({ id: 'p', provider: 'plaid', name: 'Amex', type: 'CREDIT', mask: '1234', currentBalanceCents: 4000, hasLiveConnection: true }),
      racct({ id: 'm', provider: 'manual', name: 'Amex', type: 'CREDIT', mask: '1234', currentBalanceCents: 4000 }),
    ]);
    expect(mask[0].matchSignal).toBe('mask');
    // balance + name, no mask → 'balance'
    const balance = candidatesOf([
      racct({ id: 'p', provider: 'plaid', name: 'Wells Fargo', type: 'SAVINGS', mask: null, currentBalanceCents: 21000, hasLiveConnection: true }),
      racct({ id: 's', provider: 'simplefin', name: 'WELLS FARGO', type: 'SAVINGS', mask: null, currentBalanceCents: 21000 }),
    ]);
    expect(balance[0].matchSignal).toBe('balance');
    // name only (different balances, no mask) → 'name'
    const name = candidatesOf([
      racct({ id: 'p', provider: 'plaid', name: 'Wells Fargo', currentBalanceCents: 111, hasLiveConnection: true }),
      racct({ id: 's', provider: 'simplefin', name: 'WELLS FARGO', currentBalanceCents: 999 }),
    ]);
    expect(name[0].matchSignal).toBe('name');
  });

  it('orders high-confidence candidates before medium ones', () => {
    const cands = candidatesOf([
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

describe('detectReconciliationCandidates — L.9 ambiguity carry-out', () => {
  // One stale SimpleFIN row resembling TWO live accounts — the owner's screen before this fix
  // offered both at the same badge, one tap away from folding the wrong history.
  const STALE = racct({
    id: 'stale',
    provider: 'simplefin',
    name: 'Wells Fargo Checking',
    currentBalanceCents: 48000,
    hasLiveConnection: false,
  });
  const LIVE_A = racct({
    id: 'live-a',
    provider: 'plaid',
    name: 'Wells Fargo Everyday Checking',
    mask: '1111',
    currentBalanceCents: 50000,
    hasLiveConnection: true,
  });
  const LIVE_B = racct({
    id: 'live-b',
    provider: 'plaid',
    name: 'Wells Fargo Way2Save',
    mask: '2222',
    currentBalanceCents: 90000,
    hasLiveConnection: true,
  });

  it('one predecessor matching TWO live accounts offers NEITHER and carries the group out', () => {
    const set = detectReconciliationCandidates([STALE, LIVE_A, LIVE_B]);
    expect(set.candidates).toEqual([]);
    expect(set.ambiguous).toHaveLength(1);
    expect(set.ambiguous[0].predecessor.id).toBe('stale');
    expect(set.ambiguous[0].successors.map((s) => s.id)).toEqual(['live-a', 'live-b']);
  });

  it('excludePair resolves the ambiguity — dismissing the wrong pair releases the survivor', () => {
    // The user says "stale is NOT live-b" on the duplicate-warning card. The exclusion must be
    // seen BEFORE the ambiguity rule runs (a guard must read what it guards): a post-filter
    // would leave live-a withheld forever.
    const set = detectReconciliationCandidates([STALE, LIVE_A, LIVE_B], {
      excludePair: (predId, succId) => predId === 'stale' && succId === 'live-b',
    });
    expect(set.ambiguous).toEqual([]);
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].successor.id).toBe('live-a');
  });

  it('two predecessors matching ONE successor are both offered — one live account supersedes several', () => {
    // Valid data the app already supports (#297): an old SimpleFIN row AND a still older manual
    // row can both fold into the same live account. Grouping is by PREDECESSOR, never successor.
    const manual = racct({
      id: 'manual-old',
      provider: 'manual',
      name: 'Wells Fargo',
      currentBalanceCents: 48000,
      hasLiveConnection: false,
    });
    const set = detectReconciliationCandidates([STALE, manual, LIVE_A]);
    expect(set.ambiguous).toEqual([]);
    expect(set.candidates).toHaveLength(2);
    expect(set.candidates.every((c) => c.successor.id === 'live-a')).toBe(true);
    expect(set.candidates.map((c) => c.predecessor.id).sort()).toEqual(['manual-old', 'stale']);
  });

  it('a predecessor with exactly one live match is offerable even when OTHER stale rows are ambiguous', () => {
    const secondStale = racct({
      id: 'stale-2',
      provider: 'simplefin',
      name: 'Chase Total Checking',
      currentBalanceCents: 1000,
      hasLiveConnection: false,
    });
    const chaseA = racct({ id: 'chase-a', provider: 'plaid', name: 'Chase Checking', currentBalanceCents: 2000, hasLiveConnection: true });
    const chaseB = racct({ id: 'chase-b', provider: 'plaid', name: 'Chase Premier', currentBalanceCents: 3000, hasLiveConnection: true });
    const set = detectReconciliationCandidates([STALE, LIVE_A, secondStale, chaseA, chaseB]);
    // The Wells-Fargo pair is clean; the Chase stale row is ambiguous between two live Chases.
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].predecessor.id).toBe('stale');
    expect(set.ambiguous).toHaveLength(1);
    expect(set.ambiguous[0].predecessor.id).toBe('stale-2');
  });
});

describe('detectReconciliationCandidates — L.9 registration veto (Roth ≠ Traditional)', () => {
  // The owner's exact case (2026-07-24): one SimpleFIN `Charles Schwab US Roth Contributory IRA`
  // offered against BOTH a Plaid Roth and a Plaid Traditional at the same badge. After the veto
  // only the Roth survives — the ambiguity dissolves into one offerable candidate.
  const SF_ROTH = racct({
    id: 'sf-roth',
    provider: 'simplefin',
    name: 'Charles Schwab US Roth Contributory IRA',
    type: 'INVESTMENT',
    currentBalanceCents: 500000,
    hasLiveConnection: false,
  });
  const PLAID_ROTH = racct({
    id: 'plaid-roth',
    provider: 'plaid',
    name: 'Roth IRA Brokerage Account',
    type: 'INVESTMENT',
    subtype: 'roth',
    currentBalanceCents: 510000,
    hasLiveConnection: true,
  });
  const PLAID_TRADITIONAL = racct({
    id: 'plaid-traditional',
    provider: 'plaid',
    name: 'Traditional IRA Brokerage Account',
    type: 'INVESTMENT',
    subtype: 'ira',
    currentBalanceCents: 700000,
    hasLiveConnection: true,
  });

  it('the owner case: the Traditional is vetoed, the Roth is the one offerable candidate', () => {
    const set = detectReconciliationCandidates([SF_ROTH, PLAID_ROTH, PLAID_TRADITIONAL]);
    expect(set.ambiguous).toEqual([]);
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].predecessor.id).toBe('sf-roth');
    expect(set.candidates[0].successor.id).toBe('plaid-roth');
  });

  it('veto fires even when the WRONG pair also shares a balance signal', () => {
    // Make the Traditional pair strictly more tempting: identical balance, so the strong signal
    // fires for Roth↔Traditional. The veto must still kill it — a registration is not a heuristic.
    const tempting = { ...PLAID_TRADITIONAL, currentBalanceCents: 500000 };
    const set = detectReconciliationCandidates([SF_ROTH, PLAID_ROTH, tempting]);
    expect(set.candidates.map((c) => c.successor.id)).toEqual(['plaid-roth']);
    // …and the passive warning must not re-flag the vetoed pair either.
    expect(detectDuplicateAccounts([SF_ROTH, tempting])).toEqual([]);
  });

  it('a Roth↔Roth pair can NEVER be vetoed by one side’s unspecialised `ira` subtype', () => {
    // Plaid's `ira` subtype is the fallback an institution returns for a Roth it did not
    // specialise — reading it as pretax would veto the very pair this feature exists to offer.
    const unspecialised = { ...PLAID_ROTH, subtype: 'ira' };
    const cands = candidatesOf([SF_ROTH, unspecialised]);
    expect(cands).toHaveLength(1);
    expect(cands[0].successor.id).toBe('plaid-roth');
  });

  it('no veto when only one side resolves (Roth vs a bare "IRA Brokerage") — absence is not a difference', () => {
    const bare = racct({
      id: 'plaid-bare',
      provider: 'plaid',
      name: 'IRA Brokerage Account',
      type: 'INVESTMENT',
      subtype: 'ira',
      currentBalanceCents: 500000,
      hasLiveConnection: true,
    });
    const cands = candidatesOf([SF_ROTH, bare]);
    expect(cands).toHaveLength(1);
  });

  it('no veto off INVESTMENT rows — "Roth Family Checking" vs "Traditional Checking" can still flag', () => {
    // "Roth" is a surname and "Traditional" a deposit-product word; on CHECKING rows the
    // registration reading is out of scope (identical balance is what flags this pair).
    const cands = candidatesOf([
      racct({ id: 'a', provider: 'simplefin', name: 'Roth Family Checking', type: 'CHECKING', currentBalanceCents: 12345, hasLiveConnection: false }),
      racct({ id: 'b', provider: 'plaid', name: 'Traditional Checking', type: 'CHECKING', currentBalanceCents: 12345, hasLiveConnection: true }),
    ]);
    expect(cands).toHaveLength(1);
  });

  it('subtype evidence alone resolves: a bare-named Plaid Roth still beats the Traditional for a Roth-named stale row', () => {
    // The stale SimpleFIN name says Roth; the live Plaid row's NAME says nothing ("Brokerage
    // Account") but its subtype says roth. Subtype + name read TOGETHER → the pair survives…
    const subtypeOnly = racct({
      id: 'plaid-subtype-only',
      provider: 'plaid',
      name: 'Brokerage Account',
      type: 'INVESTMENT',
      subtype: 'roth',
      currentBalanceCents: 500000,
      hasLiveConnection: true,
    });
    // …only if it matches on some signal — here the identical balance carries it.
    const cands = candidatesOf([SF_ROTH, subtypeOnly]);
    expect(cands).toHaveLength(1);
    expect(cands[0].matchSignal).toBe('balance');
  });

  it('MISFIRE LOCK (critic P1-1): a surname "Roth" on a Traditional IRA hides NO real pair', () => {
    // Executed by the fresh-context critic before the fix: this pair — one real Traditional IRA
    // seen through two providers, the Plaid side composed with the holder's surname — was VETOED
    // into a silent double-count (no warning, no candidate, no ambiguity). It must flag and
    // offer exactly as it did before the veto existed.
    const plaidSide = racct({
      id: 'plaid-trad',
      provider: 'plaid',
      name: 'Jill Roth - Traditional IRA',
      type: 'INVESTMENT',
      subtype: 'ira',
      mask: '2291',
      currentBalanceCents: 512345,
      hasLiveConnection: true,
    });
    const sfSide = racct({
      id: 'sf-trad',
      provider: 'simplefin',
      name: 'Traditional IRA - 2291 (2291)',
      type: 'INVESTMENT',
      currentBalanceCents: 512345,
      hasLiveConnection: false,
    });
    const flagged = detectDuplicateAccounts([plaidSide, sfSide]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].confidence).toBe('high'); // same last-4 (2291) + identical balance
    const cands = candidatesOf([plaidSide, sfSide]);
    expect(cands).toHaveLength(1);
    expect(cands[0].successor.id).toBe('plaid-trad');
  });
});

describe('detectReconciliationCandidates — proven identity inside ambiguity (critics P2-2/P2-3)', () => {
  // A tier-P proven pair: two Plaid connections at one bank, the bank reporting the same
  // persistent account id for both rows.
  const identityOf = (connectionId: string) => ({
    provider: 'plaid',
    institutionId: 'ins_1',
    institutionName: 'Chase',
    mask: '4034',
    type: 'CREDIT',
    subtype: null,
    currency: 'USD',
    persistentAccountId: 'pa-1',
    connectionId,
  });
  const X = racct({
    id: 'x',
    provider: 'plaid',
    name: 'Venture',
    type: 'CREDIT',
    mask: null,
    currentBalanceCents: 1000,
    hasLiveConnection: false,
    identity: { ...identityOf('item-1'), mask: null },
  });
  const Y = racct({
    id: 'y',
    provider: 'plaid',
    name: 'CREDIT CARD',
    type: 'CREDIT',
    mask: '4034',
    currentBalanceCents: 2000,
    hasLiveConnection: true,
    identity: identityOf('item-2'),
  });
  const Z = racct({
    id: 'z',
    provider: 'simplefin',
    name: 'My Venture card',
    type: 'CREDIT',
    currentBalanceCents: 3000,
    hasLiveConnection: true,
  });

  it('P2-3: a PROVEN pair outranks heuristic rivals — "we cannot tell" is false about a provable pair', () => {
    // X is proven-same to Y (the bank's own id) and name-matches Z. Saying "one of these, we
    // can't tell which" would claim ignorance the app does not have: offer the proven pair.
    const set = detectReconciliationCandidates([X, Y, Z]);
    expect(set.ambiguous).toEqual([]);
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].successor.id).toBe('y');
    expect(set.candidates[0].provenIdentity).toBe(true);
    // The withheld rival is not silent either — it stays on the duplicate notice, dismissable.
    expect(detectDuplicateAccounts([X, Z])).toHaveLength(1);
  });

  it('P2-2: the proven-partner guard reads the EXCLUDED set — resolving the live pair releases the stale one', () => {
    // X proven-same to BOTH live Y and live Z (three rows, one real account): nothing is offered
    // — X has two proven partners and "proven same as two" proves nothing about either.
    const zLive = racct({
      id: 'z2',
      provider: 'plaid',
      name: 'Chase Card',
      type: 'CREDIT',
      mask: '4034',
      currentBalanceCents: 3000,
      hasLiveConnection: true,
      identity: identityOf('item-3'),
    });
    expect(detectReconciliationCandidates([X, Y, zLive])).toEqual({ candidates: [], ambiguous: [] });
    // Resolving the both-live Y↔Z pair first (the combine card's domain) is what releases X→Y —
    // the exclusion is applied INSIDE the partner count, not after it. NOTE the exclusion shape:
    // it mirrors what the real wiring produces once Y↔Z is reconciled — the folded Z is excluded
    // from EVERY pair touching it (a folded row is never a continuation target), not only from
    // the resolved one. Excluding Y↔Z alone is a state the app never produces.
    const set = detectReconciliationCandidates([X, Y, zLive], {
      excludePair: (a, b) =>
        (a === 'y' && b === 'z2') || (a === 'z2' && b === 'y') || (a === 'x' && b === 'z2') || (a === 'z2' && b === 'x'),
    });
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].predecessor.id).toBe('x');
    expect(set.candidates[0].successor.id).toBe('y');
  });

  it('P2-2 corollary: dismissing the STALE-side pair does not shortcut the live pair’s resolution', () => {
    // Dismissing X↔Z ("the stale row is not that live one") leaves Y proven-same to TWO rows
    // (X and Z) — Y↔Z is a both-live duplicate for the combine card, and X→Y stays withheld
    // until it is resolved. Locked so the guard's conservative direction is deliberate.
    const zLive = racct({
      id: 'z2',
      provider: 'plaid',
      name: 'Chase Card',
      type: 'CREDIT',
      mask: '4034',
      currentBalanceCents: 3000,
      hasLiveConnection: true,
      identity: identityOf('item-3'),
    });
    const set = detectReconciliationCandidates([X, Y, zLive], {
      excludePair: (a, b) => (a === 'x' && b === 'z2') || (a === 'z2' && b === 'x'),
    });
    expect(set).toEqual({ candidates: [], ambiguous: [] });
  });

  it('CYCLE-2 P1: a DEAD proven partner never silences a fold — both stale rows continue into the live one', () => {
    // The L.10 re-link shape with one extra re-link: one real account connected three times, two
    // connections since disconnected. X and Z are BOTH stale and both proven-same to live Y. The
    // liveness-blind partner count withheld X→Y because of X↔Z — a pair that can never compete
    // for a fold (both-dead has no direction) — leaving two stale rows double-counting against Y
    // with no offer and no statement. Role-based counting: a directed pair counts only against
    // its dead side; both-dead counts against nothing.
    const zDead = racct({
      id: 'z-dead',
      provider: 'plaid',
      name: 'Chase Card (older)',
      type: 'CREDIT',
      mask: null,
      currentBalanceCents: 3000,
      hasLiveConnection: false,
      identity: { ...identityOf('item-3'), mask: null },
    });
    const set = detectReconciliationCandidates([X, Y, zDead]);
    expect(set.ambiguous).toEqual([]);
    // Two predecessors into ONE successor — the #297-valid shape.
    expect(set.candidates).toHaveLength(2);
    expect(set.candidates.every((c) => c.successor.id === 'y')).toBe(true);
    expect(set.candidates.map((c) => c.predecessor.id).sort()).toEqual(['x', 'z-dead']);
  });

  it('CYCLE-3 P1 (F-1): a withheld proven fold never releases a heuristic rival as a clean offer', () => {
    // The owner's own data shape: one real account on three Plaid connections (one disconnected),
    // plus a SimpleFIN row that name-matches the stale one. X's proven folds (into live Y and
    // live Z) are withheld by the role-based guard; without the suppression, the grouping stage
    // saw ONLY the name-match and offered x→s1 as a clean sole candidate — a fold the app can
    // PROVE is the wrong account (executed by the fresh-context critic). The app's own proof
    // outranks a guess: nothing is offered, nothing is grouped, and the heuristic pair stays an
    // ordinary dismissable warning while the combine card owns the proven tangle.
    const zLive = racct({
      id: 'z2',
      provider: 'plaid',
      name: 'Chase Card',
      type: 'CREDIT',
      mask: '4034',
      currentBalanceCents: 3000,
      hasLiveConnection: true,
      identity: identityOf('item-3'),
    });
    const set = detectReconciliationCandidates([X, Y, zLive, Z]);
    expect(set).toEqual({ candidates: [], ambiguous: [] });
    // …the heuristic rival is not hidden either — it warns, dismissable, on the notice.
    expect(detectDuplicateAccounts([X, Y, zLive, Z]).length).toBeGreaterThan(0);
    // …and resolving the proven tangle (Y↔Z reconciled + folded, as the combine card leaves it)
    // releases the stale fold into the terminal survivor.
    const released = detectReconciliationCandidates([X, Y, zLive, Z], {
      excludePair: (a, b) =>
        (a === 'y' && b === 'z2') || (a === 'z2' && b === 'y') || (a === 'x' && b === 'z2') || (a === 'z2' && b === 'x'),
    });
    expect(released.ambiguous).toEqual([]);
    expect(released.candidates).toHaveLength(1);
    expect(released.candidates[0].predecessor.id).toBe('x');
    expect(released.candidates[0].successor.id).toBe('y');
  });
});
