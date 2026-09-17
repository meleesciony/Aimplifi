/**
 * O.20j converse leak — same-type + mask-COLUMN copies are pairing identity.
 *
 * The remaining converse-leak population the H.7b repair could not reach was
 * 8 rows / $237.08: a Lyft / parking / rental-car on one CREDIT copy paired
 * with a filed-`transfer` TRAVEL CREDIT on the other copy of the same last-4
 * card. Confirmed reconciliation already equated those copies; unconfirmed
 * copies with the same mask COLUMN did not, so `matchTransferPairs` treated
 * two copies of one movement as a transfer. Measured live
 * (scripts/audit-probes/o20j-converse-leak.mts) on the BARE-MASK arm only:
 * that wider union refused those 8 flags and minted 0. That number is NOT
 * this function's live result — the shipped rule is narrower (institution /
 * currency / registration vetoes, stable group order, mixed-type component
 * veto). Mixed-type over-veto can refuse the 0977 fold when a confirmed
 * terminal has a different type (named residual). The advisory detector is
 * not this function's source — HIGH also fires on name-embedded years and
 * on identical-balance spouse cards (critic cycle 1). Dismissed pairs
 * ("Not a duplicate") stay two accounts.
 */
import { describe, expect, it } from 'vitest';

import {
  planTransferUpdates,
  transferIdentityDismissKey,
  unionSameMaskColumnIdentity,
  type TransferIdentityAccount,
  type TransferStateTxn,
} from '@/lib/engine/categorize/transfers';
import { planTransferFlagRepair } from '@/lib/engine/categorize/transfer-flag-repair';
import { duplicatePairDismissKey } from '@/server/duplicate-dismissal';

const base = {
  isTransfer: false,
  needsReview: false,
  reviewPinned: false,
  status: 'POSTED',
  currencySupported: true,
  categoryId: null as string | null,
  accountType: 'CREDIT',
};

function txn(over: Partial<TransferStateTxn> & Pick<TransferStateTxn, 'id'>): TransferStateTxn {
  return {
    accountId: over.accountId ?? over.id,
    date: '2024-12-09',
    amountCents: -3_325,
    rawDescriptor: 'Budget Car Rental',
    ...base,
    ...over,
  };
}

function rootOf(map: ReadonlyMap<string, string>, id: string): string {
  return map.get(id) ?? id;
}

function acct(
  over: Partial<TransferIdentityAccount> & Pick<TransferIdentityAccount, 'id'>,
): TransferIdentityAccount {
  return {
    type: 'CREDIT',
    mask: '0977',
    provider: 'plaid',
    plaidItemId: `item-${over.id}`,
    name: over.id,
    ...over,
  };
}

/** Order-independent partition of ids (roots may rename; membership must not). */
function partitionOf(map: ReadonlyMap<string, string>, ids: readonly string[]): string {
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const r = rootOf(map, id);
    const list = buckets.get(r);
    if (list) list.push(id);
    else buckets.set(r, [id]);
  }
  return [...buckets.values()]
    .map((g) => [...g].sort().join(','))
    .sort()
    .join('|');
}

/** The live 8-row shape: purchase on copy A, filed-transfer statement credit on copy B. */
function travelCreditPair(identityA?: string, identityB?: string): TransferStateTxn[] {
  return [
    txn({
      id: 'rental',
      accountId: 'card-plaid',
      accountIdentityId: identityA,
      amountCents: -3_325,
      rawDescriptor: 'Budget Car Rental',
      categoryId: 'rental-car',
    }),
    txn({
      id: 'credit',
      accountId: 'card-simplefin',
      accountIdentityId: identityB,
      amountCents: 3_325,
      rawDescriptor: 'TRAVEL CREDIT $300/YEAR',
      categoryId: 'transfer',
      isTransfer: true,
    }),
  ];
}

describe('unionSameMaskColumnIdentity', () => {
  it('leaves the confirmed map unchanged when nothing shares a mask column', () => {
    const confirmed = new Map([['old', 'live']]);
    const out = unionSameMaskColumnIdentity(confirmed, [
      acct({ id: 'x', type: 'CHECKING', mask: '1111' }),
      acct({ id: 'y', type: 'CHECKING', mask: '2222' }),
    ]);
    expect([...out.entries()]).toEqual([['old', 'live']]);
  });

  it('equates same-type copies that share a MASK COLUMN so one lookup is the same root', () => {
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'card-a', plaidItemId: 'item-1' }),
      acct({ id: 'card-b', plaidItemId: 'item-2' }),
    ]);
    expect(rootOf(out, 'card-a')).toBe(rootOf(out, 'card-b'));
  });

  it('does not equate a null-mask copy with a year-shaped last-4 on another row', () => {
    // The advisory detector's matchableMask reads "Emergency Fund (2025)" as 2025.
    // This function never sees the name: a null COLUMN is not a last-4.
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'fund-2025', type: 'CHECKING', mask: null, provider: 'simplefin' }),
      acct({ id: 'other', type: 'CHECKING', mask: '2025', plaidItemId: 'item-other' }),
    ]);
    expect(rootOf(out, 'fund-2025')).not.toBe(rootOf(out, 'other'));
    expect(out.size).toBe(0);
  });

  it('does not equate same-type accounts that only share a balance (different last-4)', () => {
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'his-checking', type: 'CHECKING', mask: '4034', plaidItemId: 'item-his' }),
      acct({ id: 'hers-checking', type: 'CHECKING', mask: '1192', provider: 'simplefin' }),
    ]);
    expect(rootOf(out, 'his-checking')).not.toBe(rootOf(out, 'hers-checking'));
    expect(out.size).toBe(0);
  });

  it('does not equate different types that share a last-4', () => {
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'card', type: 'CREDIT', mask: '4001', plaidItemId: 'item-card' }),
      acct({ id: 'checking', type: 'CHECKING', mask: '4001', plaidItemId: 'item-chk' }),
    ]);
    expect(rootOf(out, 'card')).not.toBe(rootOf(out, 'checking'));
    expect(out.size).toBe(0);
  });

  it('does not equate a dismissed pair', () => {
    const dismissed = new Set([transferIdentityDismissKey('card-a', 'card-b')]);
    const out = unionSameMaskColumnIdentity(
      new Map(),
      [acct({ id: 'card-a', plaidItemId: 'item-1' }), acct({ id: 'card-b', plaidItemId: 'item-2' })],
      dismissed,
    );
    expect(out.size).toBe(0);
  });

  it('test_regression__o20j_third_copy_does_not_defeat_a_dismissal', () => {
    // Cycle-2 P1-1: skipping the dismissed EDGE still lets a third copy join
    // both sides. A dismissed pair vetoes the whole (type, mask) component.
    const dismissed = new Set([transferIdentityDismissKey('card-a', 'card-b')]);
    const out = unionSameMaskColumnIdentity(
      new Map(),
      [
        acct({ id: 'card-a', plaidItemId: 'item-1' }),
        acct({ id: 'card-b', plaidItemId: 'item-2' }),
        acct({ id: 'card-c', plaidItemId: 'item-3' }),
      ],
      dismissed,
    );
    expect(rootOf(out, 'card-a')).not.toBe(rootOf(out, 'card-b'));
    expect(rootOf(out, 'card-a')).not.toBe(rootOf(out, 'card-c'));
    expect(rootOf(out, 'card-b')).not.toBe(rootOf(out, 'card-c'));
    expect(out.size).toBe(0);
  });

  it('test_regression__o20j_unavailable_dismissals_do_not_fold', () => {
    // Cycle-2 P1-2: a DB fault is not "no dismissals". Skip the unconfirmed union.
    const out = unionSameMaskColumnIdentity(
      new Map([['old', 'live']]),
      [acct({ id: 'card-a', plaidItemId: 'item-1' }), acct({ id: 'card-b', plaidItemId: 'item-2' })],
      'unavailable',
    );
    expect([...out.entries()]).toEqual([['old', 'live']]);
  });

  it('test_regression__o20j_same_plaid_item_same_mask_are_two_accounts', () => {
    // Cycle-2 P1-3: ingest already dedups inside one connection. Two rows on
    // ONE Plaid item that share a last-4 are two real accounts.
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'chk-a', type: 'CHECKING', mask: '1234', plaidItemId: 'one-item' }),
      acct({ id: 'chk-b', type: 'CHECKING', mask: '1234', plaidItemId: 'one-item' }),
    ]);
    expect(out.size).toBe(0);
  });

  it('test_regression__o20j_third_copy_does_not_fold_same_item_accounts', () => {
    // Cycle-3 P1-1: an edge-level same-connection skip still lets a third copy
    // (another item, or SimpleFIN) join both sides. A same-connection pair
    // vetoes the whole (type, mask) component.
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'chk-a', type: 'CHECKING', mask: '1234', plaidItemId: 'one-item' }),
      acct({ id: 'chk-b', type: 'CHECKING', mask: '1234', plaidItemId: 'one-item' }),
      acct({ id: 'chk-c', type: 'CHECKING', mask: '1234', plaidItemId: 'other-item' }),
    ]);
    expect(rootOf(out, 'chk-a')).not.toBe(rootOf(out, 'chk-b'));
    expect(rootOf(out, 'chk-a')).not.toBe(rootOf(out, 'chk-c'));
    expect(out.size).toBe(0);
  });

  it('does not equate a whitespace or 2-character mask', () => {
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'w1', mask: ' ', plaidItemId: 'item-1' }),
      acct({ id: 'w2', mask: ' ', plaidItemId: 'item-2' }),
      acct({ id: 's1', mask: '01', plaidItemId: 'item-3' }),
      acct({ id: 's2', mask: '01', plaidItemId: 'item-4' }),
    ]);
    expect(out.size).toBe(0);
  });

  it('folds a same-mask copy into an already-confirmed chain', () => {
    // The live 0977 shape: Plaid copy confirmed onto a SimpleFIN terminal
    // (null mask, so it never sits in the mask group) plus a second Plaid
    // item of the same last-4. Different connections, same type → fold.
    const confirmed = new Map([['old-card', 'live-card']]);
    const out = unionSameMaskColumnIdentity(confirmed, [
      acct({ id: 'old-card', plaidItemId: 'item-1' }),
      acct({ id: 'live-card', mask: null, provider: 'simplefin', plaidItemId: null }),
      acct({ id: 'third-copy', plaidItemId: 'item-2' }),
    ]);
    expect(rootOf(out, 'old-card')).toBe(rootOf(out, 'third-copy'));
    expect(rootOf(out, 'third-copy')).toBe(rootOf(out, 'live-card'));
  });

  it('test_regression__o20j_confirmed_bridge_does_not_defeat_a_dismissal', () => {
    // Cycle-4 P1: veto walked the mask group; union unifies root(). A
    // confirmed SimpleFIN terminal (null mask) sat outside the group, so a
    // pair the user dismissed still folded through it.
    const confirmed = new Map([['old-card', 'live-card']]);
    const dismissed = new Set([transferIdentityDismissKey('third-copy', 'live-card')]);
    const out = unionSameMaskColumnIdentity(
      confirmed,
      [
        acct({ id: 'old-card', plaidItemId: 'item-1' }),
        acct({ id: 'live-card', mask: null, provider: 'simplefin', plaidItemId: null }),
        acct({ id: 'third-copy', plaidItemId: 'item-2' }),
      ],
      dismissed,
    );
    expect(rootOf(out, 'third-copy')).not.toBe(rootOf(out, 'live-card'));
    expect(rootOf(out, 'third-copy')).not.toBe(rootOf(out, 'old-card'));
    expect(rootOf(out, 'old-card')).toBe(rootOf(out, 'live-card'));
  });

  it('test_regression__o20j_confirmed_bridge_does_not_fold_same_item_accounts', () => {
    // Cycle-4 P1: live-card and third-copy sit on ONE Plaid item (two real
    // accounts). The confirmed predecessor shares last-4 with third-copy and
    // is not in the mask group (null mask). Must not fold.
    const confirmed = new Map([['old-card', 'live-card']]);
    const out = unionSameMaskColumnIdentity(confirmed, [
      acct({ id: 'old-card', plaidItemId: 'item-1' }),
      acct({ id: 'live-card', mask: null, plaidItemId: 'item-9' }),
      acct({ id: 'third-copy', plaidItemId: 'item-9' }),
    ]);
    expect(rootOf(out, 'third-copy')).not.toBe(rootOf(out, 'live-card'));
    expect(rootOf(out, 'third-copy')).not.toBe(rootOf(out, 'old-card'));
  });

  it('test_regression__o20j_two_mask_groups_bridged_by_confirmed_stay_two_accounts', () => {
    // Cycle-4 probe D: two last-4s both confirmed onto one terminal. X and Y
    // share no mask, sit on one Plaid item, and are dismissed — yet the old
    // veto never saw them in the same group.
    const confirmed = new Map([
      ['predA', 'T'],
      ['predB', 'T'],
    ]);
    const dismissed = new Set([transferIdentityDismissKey('x-acct', 'y-acct')]);
    const out = unionSameMaskColumnIdentity(
      confirmed,
      [
        acct({ id: 'predA', type: 'CHECKING', mask: '1111', plaidItemId: 'item-dead-a' }),
        acct({ id: 'predB', type: 'CHECKING', mask: '2222', plaidItemId: 'item-dead-b' }),
        acct({
          id: 'T',
          type: 'CHECKING',
          mask: null,
          provider: 'simplefin',
          plaidItemId: null,
        }),
        acct({ id: 'x-acct', type: 'CHECKING', mask: '1111', plaidItemId: 'item-live' }),
        acct({ id: 'y-acct', type: 'CHECKING', mask: '2222', plaidItemId: 'item-live' }),
      ],
      dismissed,
    );
    expect(rootOf(out, 'x-acct')).not.toBe(rootOf(out, 'y-acct'));
  });

  it('test_regression__o20j_confirmed_bridge_does_not_equate_cross_type', () => {
    // Cycle-4 probe F: a CREDIT last-4 must not become a CHECKING identity
    // through a cross-type confirmed link.
    const out = unionSameMaskColumnIdentity(new Map([['pred-card', 'live-checking']]), [
      acct({ id: 'pred-card', type: 'CREDIT', mask: '4001', plaidItemId: 'item-1' }),
      acct({
        id: 'live-checking',
        type: 'CHECKING',
        mask: null,
        provider: 'simplefin',
        plaidItemId: null,
      }),
      acct({ id: 'other-card', type: 'CREDIT', mask: '4001', plaidItemId: 'item-2' }),
    ]);
    expect(rootOf(out, 'other-card')).not.toBe(rootOf(out, 'live-checking'));
    expect(rootOf(out, 'pred-card')).toBe(rootOf(out, 'live-checking'));
  });

  it('test_regression__o20j_different_institutions_same_last4_are_two_accounts', () => {
    // Critic P1-1: Chase checking vs Ally checking, both last-4 1234.
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({
        id: 'chase-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-chase',
        institutionId: 'ins_chase',
        name: 'Chase Total Checking',
      }),
      acct({
        id: 'ally-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-ally',
        institutionId: 'ins_ally',
        name: 'Ally Spending',
      }),
    ]);
    expect(rootOf(out, 'chase-chk')).not.toBe(rootOf(out, 'ally-chk'));
    expect(out.size).toBe(0);
  });

  it('test_regression__o20j_different_currency_same_last4_are_two_accounts', () => {
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({
        id: 'usd-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-usd',
        currency: 'USD',
      }),
      acct({
        id: 'eur-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-eur',
        currency: 'EUR',
      }),
    ]);
    expect(rootOf(out, 'usd-chk')).not.toBe(rootOf(out, 'eur-chk'));
    expect(out.size).toBe(0);
  });

  it('test_regression__o20j_roth_and_traditional_same_last4_are_two_accounts', () => {
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({
        id: 'roth',
        type: 'INVESTMENT',
        mask: '5351',
        plaidItemId: 'item-roth',
        name: 'Roth IRA',
        subtype: 'roth',
      }),
      acct({
        id: 'trad',
        type: 'INVESTMENT',
        mask: '5351',
        plaidItemId: 'item-trad',
        name: 'Traditional IRA',
        subtype: 'traditional',
      }),
    ]);
    expect(rootOf(out, 'roth')).not.toBe(rootOf(out, 'trad'));
    expect(out.size).toBe(0);
  });

  it('test_regression__o20j_0977_still_folds_when_both_plaid_copies_share_an_institution', () => {
    // P-WIDER-4: the live 0977 pair is two Plaid items of one card. Institution,
    // currency, and registration must not refuse that fold.
    const confirmed = new Map([['old-card', 'live-card']]);
    const out = unionSameMaskColumnIdentity(confirmed, [
      acct({ id: 'old-card', plaidItemId: 'item-1', institutionId: 'ins_chase' }),
      acct({
        id: 'live-card',
        mask: null,
        provider: 'simplefin',
        plaidItemId: null,
        institutionId: null,
      }),
      acct({ id: 'third-copy', plaidItemId: 'item-2', institutionId: 'ins_chase' }),
    ]);
    expect(rootOf(out, 'old-card')).toBe(rootOf(out, 'third-copy'));
    expect(rootOf(out, 'third-copy')).toBe(rootOf(out, 'live-card'));
  });

  it('test_regression__o20j_missing_account_record_fails_closed', () => {
    // Critic P2-1: a confirmed terminal absent from `accounts` is not a
    // license to fold the unconfirmed copy.
    const confirmed = new Map([['old-card', 'live-card']]);
    const out = unionSameMaskColumnIdentity(confirmed, [
      acct({ id: 'old-card', plaidItemId: 'item-1' }),
      acct({ id: 'third-copy', plaidItemId: 'item-2' }),
    ]);
    expect(rootOf(out, 'third-copy')).not.toBe(rootOf(out, 'old-card'));
    expect(rootOf(out, 'old-card')).toBe(rootOf(out, 'live-card'));
  });

  it('test_regression__o20j_identity_does_not_depend_on_account_order', () => {
    const confirmed = new Map([
      ['predA', 'T'],
      ['predB', 'T'],
    ]);
    const accounts = [
      acct({ id: 'predA', type: 'CHECKING', mask: '1111', plaidItemId: 'item-dead-a' }),
      acct({ id: 'predB', type: 'CHECKING', mask: '2222', plaidItemId: 'item-dead-b' }),
      acct({
        id: 'T',
        type: 'CHECKING',
        mask: null,
        provider: 'simplefin',
        plaidItemId: null,
      }),
      acct({ id: 'x-acct', type: 'CHECKING', mask: '1111', plaidItemId: 'item-live' }),
      acct({ id: 'y-acct', type: 'CHECKING', mask: '2222', plaidItemId: 'item-live' }),
    ];
    const ids = accounts.map((a) => a.id);
    const forward = unionSameMaskColumnIdentity(confirmed, accounts);
    const reverse = unionSameMaskColumnIdentity(confirmed, [...accounts].reverse());
    expect(partitionOf(reverse, ids)).toBe(partitionOf(forward, ids));
    // 1111 sorts before 2222: x folds onto T, y stays its own account.
    expect(rootOf(forward, 'x-acct')).toBe(rootOf(forward, 'T'));
    expect(rootOf(forward, 'y-acct')).not.toBe(rootOf(forward, 'T'));
    let seed = 0x9e3779b9;
    const shuffle = (src: TransferIdentityAccount[]): TransferIdentityAccount[] => {
      const a = [...src];
      for (let i = a.length - 1; i > 0; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = seed % (i + 1);
        const tmp = a[i]!;
        a[i] = a[j]!;
        a[j] = tmp;
      }
      return a;
    };
    for (let n = 0; n < 20; n++) {
      const shuffled = unionSameMaskColumnIdentity(confirmed, shuffle(accounts));
      expect(partitionOf(shuffled, ids)).toBe(partitionOf(forward, ids));
    }
  });

  it('the dismiss-key format is byte-identical to duplicatePairDismissKey', () => {
    expect(transferIdentityDismissKey('b', 'a')).toBe(duplicatePairDismissKey('b', 'a'));
    expect(transferIdentityDismissKey('a', 'b')).toBe(duplicatePairDismissKey('a', 'b'));
  });
});

describe('planTransferUpdates: same-mask-column copies do not pair (O.20j)', () => {
  it('test_regression__o20j_unconfirmed_duplicate_travel_credit_does_not_overturn_the_purchase', () => {
    // FAIL-OLD: without identity, the filed-transfer leaf on the credit (#487)
    // propagates across the pair and overturns the rental-car purchase.
    const without = planTransferUpdates(travelCreditPair());
    expect(without.overturnIds.sort()).toEqual(['rental']);

    // After identity (what loadTransferSweepRows now stamps), they are one card.
    const withId = planTransferUpdates(travelCreditPair('card-real', 'card-real'));
    expect(withId.flagIds).toEqual([]);
    expect(withId.overturnIds).toEqual([]);
    expect(withId.fileIds).toEqual([]);
  });

  it('test_regression__o20j_cash_advance_credit_to_checking_still_propagates', () => {
    // The descriptor-propagation loop exists for this: CREDIT outflow +
    // CHECKING "ONLINE TRANSFER FROM VISA". Identity must not eat it — even
    // when the two accounts coincidentally share a last-4 (different type).
    const identity = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'card', type: 'CREDIT', mask: '4001', plaidItemId: 'item-card' }),
      acct({ id: 'checking', type: 'CHECKING', mask: '4001', plaidItemId: 'item-chk' }),
    ]);
    const plan = planTransferUpdates([
      txn({
        id: 'advance',
        accountId: 'card',
        accountIdentityId: rootOf(identity, 'card'),
        accountType: 'CREDIT',
        amountCents: -500_000,
        rawDescriptor: 'CASH ADVANCE',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
      txn({
        id: 'landed',
        accountId: 'checking',
        accountIdentityId: rootOf(identity, 'checking'),
        accountType: 'CHECKING',
        amountCents: 500_000,
        rawDescriptor: 'ONLINE TRANSFER FROM VISA 4001',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
    ]);
    expect(plan.flagIds.sort()).toEqual(['advance', 'landed']);
  });

  it('test_regression__o20j_checking_to_checking_different_last4_still_pairs', () => {
    const identity = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'chk-a', type: 'CHECKING', mask: '1111', plaidItemId: 'item-a' }),
      acct({ id: 'chk-b', type: 'CHECKING', mask: '2222', plaidItemId: 'item-b' }),
    ]);
    const plan = planTransferUpdates([
      txn({
        id: 'sent',
        accountId: 'chk-a',
        accountIdentityId: rootOf(identity, 'chk-a'),
        accountType: 'CHECKING',
        amountCents: -80_000,
        rawDescriptor: 'ONLINE TRANSFER TO SAVINGS',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
      txn({
        id: 'landed',
        accountId: 'chk-b',
        accountIdentityId: rootOf(identity, 'chk-b'),
        accountType: 'CHECKING',
        amountCents: 80_000,
        rawDescriptor: 'ONLINE TRANSFER FROM CHECKING',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
    ]);
    expect(plan.flagIds.sort()).toEqual(['landed', 'sent']);
  });

  it('test_regression__o20j_same_item_same_mask_checkings_still_pair', () => {
    // Cycle-2 P1-3: two accounts inside ONE Plaid item sharing a last-4 are
    // two real accounts. A genuine transfer between them must still pair.
    const identity = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'chk-a', type: 'CHECKING', mask: '1234', plaidItemId: 'one-item' }),
      acct({ id: 'chk-b', type: 'CHECKING', mask: '1234', plaidItemId: 'one-item' }),
    ]);
    const plan = planTransferUpdates([
      txn({
        id: 'sent',
        accountId: 'chk-a',
        accountIdentityId: rootOf(identity, 'chk-a'),
        accountType: 'CHECKING',
        amountCents: -250_000,
        rawDescriptor: 'ZEBRA ITEM MOVE',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
      txn({
        id: 'landed',
        accountId: 'chk-b',
        accountIdentityId: rootOf(identity, 'chk-b'),
        accountType: 'CHECKING',
        amountCents: 250_000,
        rawDescriptor: 'ZEBRA ITEM MOVE IN',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
    ]);
    expect(plan.flagIds.sort()).toEqual(['landed', 'sent']);
    expect(plan.fileIds.sort()).toEqual(['landed', 'sent']);
  });

  it('test_regression__o20j_third_copy_does_not_unfile_a_same_item_transfer', () => {
    // Cycle-3 P1-1: adding a third same-mask copy from another connection must
    // not un-flag a genuine transfer between two accounts on ONE Plaid item.
    const identity = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'chk-a', type: 'CHECKING', mask: '1234', plaidItemId: 'one-item' }),
      acct({ id: 'chk-b', type: 'CHECKING', mask: '1234', plaidItemId: 'one-item' }),
      acct({ id: 'chk-c', type: 'CHECKING', mask: '1234', plaidItemId: 'other-item' }),
    ]);
    const plan = planTransferUpdates([
      txn({
        id: 'sent',
        accountId: 'chk-a',
        accountIdentityId: rootOf(identity, 'chk-a'),
        accountType: 'CHECKING',
        amountCents: -250_000,
        rawDescriptor: 'ZEBRA ITEM MOVE',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
      txn({
        id: 'landed',
        accountId: 'chk-b',
        accountIdentityId: rootOf(identity, 'chk-b'),
        accountType: 'CHECKING',
        amountCents: 250_000,
        rawDescriptor: 'ZEBRA ITEM MOVE IN',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
    ]);
    expect(plan.flagIds.sort()).toEqual(['landed', 'sent']);
    expect(plan.fileIds.sort()).toEqual(['landed', 'sent']);
  });

  it('test_regression__o20j_confirmed_bridge_does_not_unfile_a_same_item_transfer', () => {
    const confirmed = new Map([['old-card', 'live-card']]);
    const identity = unionSameMaskColumnIdentity(confirmed, [
      acct({ id: 'old-card', type: 'CHECKING', mask: '1234', plaidItemId: 'item-1' }),
      acct({ id: 'live-card', type: 'CHECKING', mask: null, plaidItemId: 'item-9' }),
      acct({ id: 'third-copy', type: 'CHECKING', mask: '1234', plaidItemId: 'item-9' }),
    ]);
    const plan = planTransferUpdates([
      txn({
        id: 'sent',
        accountId: 'live-card',
        accountIdentityId: rootOf(identity, 'live-card'),
        accountType: 'CHECKING',
        amountCents: -250_000,
        rawDescriptor: 'ZEBRA BRIDGE MOVE',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
      txn({
        id: 'landed',
        accountId: 'third-copy',
        accountIdentityId: rootOf(identity, 'third-copy'),
        accountType: 'CHECKING',
        amountCents: 250_000,
        rawDescriptor: 'ZEBRA BRIDGE MOVE IN',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
    ]);
    expect(plan.flagIds.sort()).toEqual(['landed', 'sent']);
    expect(plan.fileIds.sort()).toEqual(['landed', 'sent']);
  });

  it('test_regression__o20j_confirmed_two_mask_groups_do_not_unfile_a_dismissed_transfer', () => {
    const confirmed = new Map([
      ['predA', 'T'],
      ['predB', 'T'],
    ]);
    const dismissed = new Set([transferIdentityDismissKey('x-acct', 'y-acct')]);
    const identity = unionSameMaskColumnIdentity(
      confirmed,
      [
        acct({ id: 'predA', type: 'CHECKING', mask: '1111', plaidItemId: 'item-dead-a' }),
        acct({ id: 'predB', type: 'CHECKING', mask: '2222', plaidItemId: 'item-dead-b' }),
        acct({
          id: 'T',
          type: 'CHECKING',
          mask: null,
          provider: 'simplefin',
          plaidItemId: null,
        }),
        acct({ id: 'x-acct', type: 'CHECKING', mask: '1111', plaidItemId: 'item-live' }),
        acct({ id: 'y-acct', type: 'CHECKING', mask: '2222', plaidItemId: 'item-live' }),
      ],
      dismissed,
    );
    const plan = planTransferUpdates([
      txn({
        id: 'sent',
        accountId: 'x-acct',
        accountIdentityId: rootOf(identity, 'x-acct'),
        accountType: 'CHECKING',
        amountCents: -250_000,
        rawDescriptor: 'ZEBRA MOVE',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
      txn({
        id: 'landed',
        accountId: 'y-acct',
        accountIdentityId: rootOf(identity, 'y-acct'),
        accountType: 'CHECKING',
        amountCents: 250_000,
        rawDescriptor: 'ZEBRA MOVE IN',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
    ]);
    expect(plan.flagIds.sort()).toEqual(['landed', 'sent']);
    expect(plan.fileIds.sort()).toEqual(['landed', 'sent']);
  });

  it('test_regression__o20j_chase_ally_same_last4_transfer_still_flags', () => {
    // Critic P1-1 executed: $2,000 Chase→Ally with last-4 1234 was swallowed
    // when the union treated them as one account. They are two banks.
    const identity = unionSameMaskColumnIdentity(new Map(), [
      acct({
        id: 'chase-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-chase',
        institutionId: 'ins_chase',
        name: 'Chase Total Checking',
      }),
      acct({
        id: 'ally-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-ally',
        institutionId: 'ins_ally',
        name: 'Ally Spending',
      }),
    ]);
    const plan = planTransferUpdates([
      txn({
        id: 'out',
        accountId: 'chase-chk',
        accountIdentityId: rootOf(identity, 'chase-chk'),
        accountType: 'CHECKING',
        amountCents: -200_000,
        rawDescriptor: 'CHASE TO ALLY',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
      txn({
        id: 'inn',
        accountId: 'ally-chk',
        accountIdentityId: rootOf(identity, 'ally-chk'),
        accountType: 'CHECKING',
        amountCents: 200_000,
        rawDescriptor: 'FROM CHASE',
        categoryId: 'uncategorized',
        needsReview: true,
      }),
    ]);
    expect(plan.flagIds.sort()).toEqual(['inn', 'out']);
    expect(plan.fileIds.sort()).toEqual(['inn', 'out']);
  });

  it('test_regression__o20j_purchase_refund_does_not_depend_on_account_order', () => {
    // Critic P1-2: unordered findMany made one order ignore a purchase/refund
    // (correct fold) and the reverse file it as a transfer.
    const confirmed = new Map([
      ['predA', 'T'],
      ['predB', 'T'],
    ]);
    const accounts = [
      acct({ id: 'predA', type: 'CHECKING', mask: '1111', plaidItemId: 'item-dead-a' }),
      acct({ id: 'predB', type: 'CHECKING', mask: '2222', plaidItemId: 'item-dead-b' }),
      acct({
        id: 'T',
        type: 'CHECKING',
        mask: null,
        provider: 'simplefin',
        plaidItemId: null,
      }),
      acct({ id: 'x-acct', type: 'CHECKING', mask: '1111', plaidItemId: 'item-live' }),
      acct({ id: 'y-acct', type: 'CHECKING', mask: '2222', plaidItemId: 'item-live' }),
    ];
    for (const order of [accounts, [...accounts].reverse()]) {
      const identity = unionSameMaskColumnIdentity(confirmed, order);
      const plan = planTransferUpdates([
        txn({
          id: 'purchase',
          accountId: 'predA',
          accountIdentityId: rootOf(identity, 'predA'),
          accountType: 'CHECKING',
          amountCents: -4_500,
          rawDescriptor: 'STORE PURCHASE',
          categoryId: 'shopping',
        }),
        txn({
          id: 'refund',
          accountId: 'x-acct',
          accountIdentityId: rootOf(identity, 'x-acct'),
          accountType: 'CHECKING',
          amountCents: 4_500,
          rawDescriptor: 'STORE REFUND',
          categoryId: 'shopping',
        }),
      ]);
      expect(plan.flagIds).toEqual([]);
      expect(plan.fileIds).toEqual([]);
    }
  });
});

describe('H.7b repair reach after same-mask-column identity (O.20j)', () => {
  it('test_regression__o20j_repair_clears_the_duplicate_travel_credit_purchase_once_identity_equates', () => {
    const flagged = travelCreditPair('card-real', 'card-real').map((t) =>
      t.id === 'rental' ? { ...t, isTransfer: true } : t,
    );
    const plan = planTransferFlagRepair(flagged);
    expect(plan.clearIds).toEqual(['rental']);
    expect(plan.outflowCents).toBe(3_325);
  });

  it('without identity the same flag stays endorsed (today\'s pre-fix rule)', () => {
    const flagged = travelCreditPair().map((t) => (t.id === 'rental' ? { ...t, isTransfer: true } : t));
    const plan = planTransferFlagRepair(flagged);
    expect(plan.clearIds).toEqual([]);
    expect(plan.endorsedCount).toBe(2);
  });
});
