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
 * ("Not a duplicate") stay two accounts. Residual (2): two Plaid items with
 * a missing `ins_*` must not fold on last-4 — an absence is not a bank.
 * Residual (4): live 0977 is stamp NULL + PlaidItem `ins_56`; the fold reads
 * `resolveLiveInstitutionId`, not the account stamp.
 * Residual (5): a present PlaidItem whose `institutionId` is null does not
 * fall through to the Account stamp — last-known is only for disconnect.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  planTransferUpdates,
  resolveLiveInstitutionId,
  resolveLiveInstitutionName,
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
  const provider = over.provider ?? 'plaid';
  return {
    type: 'CREDIT',
    mask: '0977',
    provider: 'plaid',
    plaidItemId: `item-${over.id}`,
    name: over.id,
    // Plaid fixtures share a bank unless the test is ABOUT a missing or
    // different `ins_*`. SimpleFIN never carries Plaid's id (expected-null).
    institutionId: provider === 'plaid' ? 'ins_chase' : null,
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
    // They also share a bank (`acct` defaults Plaid to ins_chase). Last-4
    // alone is not identity — see residual (2) below.
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

  it('test_regression__o20j_plaid_plaid_missing_institution_ids_do_not_fold_on_last4', () => {
    // Residual (2): pre-backfill Plaid items carry null ins_*. Last-4 is not a
    // bank — Chase vs Ally with no id must stay two accounts, same as when
    // the ids are present and different.
    const bothNull = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'card-a', plaidItemId: 'item-1', institutionId: null }),
      acct({ id: 'card-b', plaidItemId: 'item-2', institutionId: null }),
    ]);
    expect(rootOf(bothNull, 'card-a')).not.toBe(rootOf(bothNull, 'card-b'));
    expect(bothNull.size).toBe(0);

    const oneNull = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'known', plaidItemId: 'item-1', institutionId: 'ins_chase' }),
      acct({ id: 'unknown', plaidItemId: 'item-2', institutionId: null }),
    ]);
    expect(rootOf(oneNull, 'known')).not.toBe(rootOf(oneNull, 'unknown'));
    expect(oneNull.size).toBe(0);

    const blank = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'ws-a', plaidItemId: 'item-1', institutionId: '   ' }),
      acct({ id: 'ws-b', plaidItemId: 'item-2', institutionId: '' }),
    ]);
    expect(rootOf(blank, 'ws-a')).not.toBe(rootOf(blank, 'ws-b'));
    expect(blank.size).toBe(0);
  });

  it('test_regression__o20j_unproven_plaid_does_not_fold_onto_a_non_plaid_last4', () => {
    // Critic P1-2: last-4 is not a bank even when the other side is SimpleFIN,
    // manual, or demo. A Plaid row with no `ins_*` is unproven against anyone.
    const sfin = unionSameMaskColumnIdentity(new Map(), [
      acct({
        id: 'plaid-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-1',
        institutionId: null,
      }),
      acct({
        id: 'sfin-chk',
        type: 'CHECKING',
        mask: '1234',
        provider: 'simplefin',
        plaidItemId: null,
        institutionId: null,
      }),
    ]);
    expect(rootOf(sfin, 'plaid-chk')).not.toBe(rootOf(sfin, 'sfin-chk'));
    expect(sfin.size).toBe(0);

    const manual = unionSameMaskColumnIdentity(new Map(), [
      acct({
        id: 'plaid-card',
        mask: '0977',
        plaidItemId: 'item-1',
        institutionId: null,
      }),
      acct({
        id: 'manual-card',
        mask: '0977',
        provider: 'manual',
        plaidItemId: null,
        institutionId: null,
      }),
    ]);
    expect(rootOf(manual, 'plaid-card')).not.toBe(rootOf(manual, 'manual-card'));
    expect(manual.size).toBe(0);
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

  it('test_regression__o20j_live_0977_join_is_item_ins_over_a_null_stamp', () => {
    // #748 critic P2-2: live shape is Account.institutionId NULL +
    // PlaidItem.institutionId ins_56. The fold must read the join, not the
    // stamp — a stamp-only map keeps the filing fixture green and refuses
    // the live pair.
    const items = new Map<string, string | null>([
      ['item-1', 'ins_56'],
      ['item-2', 'ins_56'],
    ]);
    const joined = [
      acct({ id: 'card-a', plaidItemId: 'item-1', institutionId: null }),
      acct({ id: 'card-b', plaidItemId: 'item-2', institutionId: null }),
    ].map((a) => ({
      ...a,
      institutionId: resolveLiveInstitutionId(a.plaidItemId, a.institutionId, items),
    }));
    const out = unionSameMaskColumnIdentity(new Map(), joined);
    expect(joined.map((a) => a.institutionId)).toEqual(['ins_56', 'ins_56']);
    expect(rootOf(out, 'card-a')).toBe(rootOf(out, 'card-b'));
  });

  it('test_regression__o20j_live_null_item_ignores_a_stale_matching_stamp', () => {
    // #749 critic P2-1: Map.get + ?? treats a present-null item like a
    // missing key. Two live pre-backfill Plaid items with matching stale
    // stamps would then fold on last-4 — the #748 hole, one hop later.
    const items = new Map<string, string | null>([
      ['item-1', null],
      ['item-2', null],
    ]);
    const joined = [
      acct({ id: 'card-a', plaidItemId: 'item-1', institutionId: 'ins_stale' }),
      acct({ id: 'card-b', plaidItemId: 'item-2', institutionId: 'ins_stale' }),
    ].map((a) => ({
      ...a,
      institutionId: resolveLiveInstitutionId(a.plaidItemId, a.institutionId, items),
    }));
    const out = unionSameMaskColumnIdentity(new Map(), joined);
    expect(joined.map((a) => a.institutionId)).toEqual([null, null]);
    expect(out.size).toBe(0);
    expect(rootOf(out, 'card-a')).not.toBe(rootOf(out, 'card-b'));
  });

  it('test_regression__o20j_stamp_only_0977_does_not_stand_in_for_the_join', () => {
    // Same two rows, stamps still null, no item map → fail closed (the
    // join regression: ignore PlaidItem, keep the stamp). Must NOT fold.
    const out = unionSameMaskColumnIdentity(new Map(), [
      acct({ id: 'card-a', plaidItemId: 'item-1', institutionId: null }),
      acct({ id: 'card-b', plaidItemId: 'item-2', institutionId: null }),
    ]);
    expect(out.size).toBe(0);
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

  it('test_regression__o20j_plaid_plaid_missing_institution_same_last4_transfer_still_flags', () => {
    // Residual (2) money lock: the Chase→Ally $2,000 shape, but both items
    // pre-backfill (null ins_*). Folding them on last-4 would swallow a real
    // transfer the same way present-and-different ids used to.
    const identity = unionSameMaskColumnIdentity(new Map(), [
      acct({
        id: 'chase-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-chase',
        institutionId: null,
        name: 'Chase Total Checking',
      }),
      acct({
        id: 'ally-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-ally',
        institutionId: null,
        name: 'Ally Spending',
      }),
    ]);
    expect(rootOf(identity, 'chase-chk')).not.toBe(rootOf(identity, 'ally-chk'));
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

  it('test_regression__o20j_unproven_plaid_plus_simplefin_same_last4_transfer_still_flags', () => {
    // Critic P1-2 money lock: Plaid(null ins_*) + SimpleFIN(null) sharing a
    // last-4 must not swallow a $2,000 transfer.
    const identity = unionSameMaskColumnIdentity(new Map(), [
      acct({
        id: 'chase-chk',
        type: 'CHECKING',
        mask: '1234',
        plaidItemId: 'item-chase',
        institutionId: null,
        name: 'Chase Total Checking',
      }),
      acct({
        id: 'sfin-chk',
        type: 'CHECKING',
        mask: '1234',
        provider: 'simplefin',
        plaidItemId: null,
        institutionId: null,
        name: 'Ally Spending',
      }),
    ]);
    expect(rootOf(identity, 'chase-chk')).not.toBe(rootOf(identity, 'sfin-chk'));
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
        accountId: 'sfin-chk',
        accountIdentityId: rootOf(identity, 'sfin-chk'),
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

describe('resolveLiveInstitutionId (O.20j residual 4)', () => {
  it('presents the live 0977 join: stamp null, item ins_56', () => {
    const items = new Map<string, string | null>([['item-a', 'ins_56']]);
    expect(resolveLiveInstitutionId('item-a', null, items)).toBe('ins_56');
  });

  it('falls back to the stamp when the item is gone (disconnect)', () => {
    expect(resolveLiveInstitutionId('item-dead', 'ins_56', new Map())).toBe('ins_56');
  });

  it('the live item wins over a stale stamp', () => {
    const items = new Map<string, string | null>([['item-a', 'ins_56']]);
    expect(resolveLiveInstitutionId('item-a', 'ins_stale', items)).toBe('ins_56');
  });

  it('a present live-null item does not fall through to the stamp', () => {
    // #749 critic P2-1: Map.has, not ??. Disconnect (no key) still uses the
    // stamp — the case above. A live item with null ins_* is unproven.
    const items = new Map<string, string | null>([['item-a', null]]);
    expect(resolveLiveInstitutionId('item-a', 'ins_stale', items)).toBeNull();
  });

  it('missing both is null — last-4 is not a bank', () => {
    expect(resolveLiveInstitutionId('item-a', null, new Map())).toBeNull();
    expect(resolveLiveInstitutionId(null, null, new Map())).toBeNull();
  });

  it('test_regression__o20j_transfer_refresh_calls_the_join_not_the_stamp', () => {
    // Critic P2-2: a wiring lock the unit suite can reach. Deleting the
    // helper call (or restoring the inlined stamp-only expression) dies here.
    const src = readFileSync(resolve('src/lib/providers/transfer-refresh.ts'), 'utf8');
    const loadStart = src.indexOf('export async function loadTransferSweepRows');
    expect(loadStart).toBeGreaterThan(-1);
    const loadEnd = src.indexOf('export async function refreshTransferFlags', loadStart);
    expect(loadEnd).toBeGreaterThan(loadStart);
    const load = src.slice(loadStart, loadEnd);
    expect(load).toContain('resolveLiveInstitutionId(a.plaidItemId, a.institutionId, institutionByItem)');
    expect(load).not.toMatch(/institutionId:\s*a\.institutionId/);
  });

  it('test_regression__o20j_combine_and_accounts_call_the_same_join_not_the_inline_fallthrough', () => {
    // #750 critic P2-1: combine-connections and /accounts inlined
    // `item?.institutionId ?? stamp`, so a present-null item inherited the
    // stamp and the identity ladder could prove SAME while the transfer
    // writer fail-closed. One helper, three callers.
    const combine = readFileSync(resolve('src/server/combine-connections.ts'), 'utf8');
    const accounts = readFileSync(resolve('src/server/transactions.ts'), 'utf8');
    expect(combine).toContain(
      'resolveLiveInstitutionId(a.plaidItemId, a.institutionId, institutionIdByItem)',
    );
    expect(accounts).toContain(
      'resolveLiveInstitutionId(a.plaidItemId, a.institutionId, institutionIdByItem)',
    );
    expect(combine).not.toMatch(/item\?\.institutionId\s*\?\?\s*a\.institutionId/);
    expect(accounts).not.toMatch(/item\?\.institutionId\s*\?\?\s*a\.institutionId/);
  });
});

describe('resolveLiveInstitutionName (O.20j residual 7 / #752 P2-1)', () => {
  it('a present live-null name does not fall through to the stamp', () => {
    const items = new Map<string, string | null>([['item-a', null]]);
    expect(resolveLiveInstitutionName('item-a', 'Chase', items)).toBeNull();
  });

  it('falls back to the stamp when the item is gone (disconnect)', () => {
    expect(resolveLiveInstitutionName('item-dead', 'Chase', new Map())).toBe('Chase');
  });

  it('the live name wins over a stale stamp', () => {
    const items = new Map<string, string | null>([['item-a', 'Chase']]);
    expect(resolveLiveInstitutionName('item-a', 'Ally', items)).toBe('Chase');
  });

  it('a live name still wins over a null stamp', () => {
    const items = new Map<string, string | null>([['item-a', 'Chase']]);
    expect(resolveLiveInstitutionName('item-a', null, items)).toBe('Chase');
  });

  it('test_regression__o20j_combine_and_accounts_call_the_name_join_not_the_inline_fallthrough', () => {
    // #752 critic P2-1: the name join still inlined `item?.institution ?? stamp`.
    const combine = readFileSync(resolve('src/server/combine-connections.ts'), 'utf8');
    const accounts = readFileSync(resolve('src/server/transactions.ts'), 'utf8');
    expect(combine).toContain(
      'resolveLiveInstitutionName(a.plaidItemId, a.institutionName, institutionNameByItem)',
    );
    expect(accounts).toContain(
      'resolveLiveInstitutionName(a.plaidItemId, a.institutionName, institutionNameByItem)',
    );
    expect(combine).not.toMatch(/item\?\.institution\s*\?\?\s*a\.institutionName/);
    expect(accounts).not.toMatch(/item\?\.institution\s*\?\?\s*a\.institutionName/);
  });
});
