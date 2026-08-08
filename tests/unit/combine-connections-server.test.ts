/**
 * Combining two live duplicate connections — the ACTION contract, against real Prisma
 * (TASKS L.6 / L.10; docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §4 layer 3).
 *
 * The fixture is the owner's own, from his 2026-07-24 /accounts screenshots: two live Plaid
 * connections at Chase, each carrying `CREDIT CARD ····0977` at −$8,539.09, so his Liabilities
 * counted $8,539.09 twice and his cash-needed headline was inflated by the same amount.
 *
 * The money proof is the last test: after the combine, `getAccountsView` — the same read the
 * page renders — reports the card ONCE. Everything before it is the refusals, because an action
 * that disconnects a bank must refuse far more often than it acts.
 *
 * The Plaid disconnect is injected: the real one calls `/item/remove` then deletes the row, so
 * the fake does the row deletion, which is the only part the rest of the app can observe.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { stampConnectionIdentity } from '@/lib/providers/plaid-identity';
import { buildCombineInputs, combineDuplicateConnectionsFor } from '@/server/combine-connections';
import { getAccountsView, getTransactions } from '@/server/transactions';
import { duplicatePairDismissKey } from '@/server/duplicate-dismissal';

const uid = `combine-${Date.now()}-${process.pid}`;
const TODAY = isoDate('2026-07-24');

const wipe = async () => {
  await prisma.user.deleteMany({ where: { id: uid } });
};

/** Stands in for `PlaidProvider.removeItem` with the network removed. It calls the SAME
 *  `stampConnectionIdentity` the real path calls and then deletes the row, because those two
 *  effects are what the rest of the app observes: the dropped side goes stale, and its rows keep
 *  the bank identity that the deleted connection row was holding. */
const fakeDisconnect = async (userId: string, itemId: string) => {
  const item = await prisma.plaidItem.findFirst({ where: { userId, itemId } });
  if (item) await stampConnectionIdentity(userId, item);
  await prisma.plaidItem.deleteMany({ where: { userId, itemId } });
};

const explodingDisconnect = async () => {
  throw new Error('Plaid said no.');
};

/** The real revoke takes the captured token; these fakes ignore it. */

async function seed(opts: { extraOnNew?: boolean; differentMask?: boolean } = {}) {
  await wipe();
  await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
  await prisma.plaidItem.createMany({
    data: [
      {
        userId: uid,
        itemId: 'item-first',
        accessToken: 'enc:first',
        institution: 'Chase',
        institutionId: 'ins_56',
        lastSyncedAt: '2026-07-24',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: uid,
        itemId: 'item-second',
        accessToken: 'enc:second',
        institution: 'Chase',
        institutionId: 'ins_56',
        lastSyncedAt: '2026-07-24',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ],
  });
  await prisma.account.createMany({
    data: [
      {
        id: `${uid}-a1`,
        userId: uid,
        provider: 'plaid',
        providerRef: 'acct-1',
        plaidItemId: 'item-first',
        name: 'CREDIT CARD',
        type: 'CREDIT',
        mask: '0977',
        subtype: 'credit card',
        currentBalanceCents: 853_909,
        currency: 'USD',
      },
      {
        id: `${uid}-a2`,
        userId: uid,
        provider: 'plaid',
        providerRef: 'acct-2',
        plaidItemId: 'item-second',
        name: 'CREDIT CARD',
        type: 'CREDIT',
        mask: opts.differentMask ? '4927' : '0977',
        subtype: 'credit card',
        currentBalanceCents: 853_909,
        currency: 'USD',
      },
      ...(opts.extraOnNew
        ? [
            {
              id: `${uid}-a3`,
              userId: uid,
              provider: 'plaid',
              providerRef: 'acct-3',
              plaidItemId: 'item-second',
              name: 'CHECKING',
              type: 'CHECKING',
              mask: '1111',
              subtype: 'checking',
              currentBalanceCents: 120_000,
              currency: 'USD',
            },
          ]
        : []),
    ],
  });
  // One transaction on each row, same real charge seen through both connections.
  await prisma.transaction.createMany({
    data: [
      { accountId: `${uid}-a1`, date: '2026-07-20', rawDescriptor: 'COSTCO', amountCents: -12_000, status: 'POSTED' },
      { accountId: `${uid}-a2`, date: '2026-07-20', rawDescriptor: 'COSTCO', amountCents: -12_000, status: 'POSTED' },
    ],
  });
}

afterAll(wipe);

describe('combineDuplicateConnectionsFor — refusals', () => {
  beforeEach(() => seed());

  it('refuses a direction the engine does not offer (the ids reversed into a stranding combine)', async () => {
    await seed({ extraOnNew: true });
    // Dropping the newer connection would freeze its CHECKING row, which is nobody's duplicate.
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    // Nothing was disconnected: the refusal happens before the irreversible step.
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
  });

  it('refuses when the two cards have different last-4s (his card and his wife’s)', async () => {
    await seed({ differentMask: true });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
    expect(await prisma.accountReconciliation.count({ where: { userId: uid } })).toBe(0);
  });

  it('refuses the same connection twice', async () => {
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-first' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
  });

  it('refuses another user’s connection id exactly like a made-up one', async () => {
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'somebody-elses-item' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
  });

  it('refuses non-scalar input before touching the database', async () => {
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: { evil: true }, dropItemId: ['x'] } as never,
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
  });

  it('refuses the shared demo account outright', async () => {
    const res = await combineDuplicateConnectionsFor(
      'user-demo',
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
  });

  it('finishes the combine when Plaid never confirms the revoke — and says so', async () => {
    // The claim (drop the connection locally + link the pair) commits first, so a bank that never
    // answers cannot leave the user half-done. What it CAN leave is a token still live upstream,
    // which is a fact about their data and is reported rather than swallowed.
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      explodingDisconnect,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.combined).toBe(1);
      expect(res.revokeFailed).toBe('Plaid said no.');
    }
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(1);
    expect(await prisma.accountReconciliation.count({ where: { userId: uid } })).toBe(1);
  });
});

describe('combineDuplicateConnectionsFor — the owner’s Chase pair', () => {
  beforeEach(() => seed());

  it('offers the pair on /accounts before anything is done', async () => {
    const view = await getAccountsView(uid);
    expect(view.combinableConnections).toHaveLength(1);
    const [p] = view.combinableConnections;
    expect(p.institutionLabel).toBe('Chase');
    expect(p.recommended.keepItemId).toBe('item-first');
    expect(p.recommended.dropItemId).toBe('item-second');
    expect(p.alternative?.keepItemId).toBe('item-second');
  });

  it('H.6c: /accounts recommends keeping the connection whose FEED history reaches further back', async () => {
    // The deepen shape, through the REAL fetch site: the second connection was created to carry
    // Plaid's 730-day window and its background pull has landed a 2024 row the first connection
    // never had. Both healthy, both synced the same day — before H.6c the tie fell to "linked
    // first wins" and the prominent button proposed revoking the deep side. This test is what
    // an empty depth map at the getAccountsView call site would turn red: the ranking must be
    // fed the rows actually stored, not a shape that satisfies the compiler.
    await prisma.transaction.create({
      data: {
        accountId: `${uid}-a2`, providerRef: 'pl-deep-1', date: '2024-08-08',
        rawDescriptor: 'OLDER HISTORY', amountCents: -5_000, status: 'POSTED',
      },
    });
    // …and a hand-typed 2019 row on the OLD side (providerRef null — manual and CSV rows carry
    // none). The H.6c critic executed the all-rows version of this ranking: one backdated manual
    // entry flipped the recommendation onto a direction the no-loss guard then refuses, turning
    // the prominent button into a dead end. Feed depth must ignore it.
    await prisma.transaction.create({
      data: { accountId: `${uid}-a1`, date: '2019-03-15', rawDescriptor: 'CHECK #204', amountCents: -49_300, status: 'POSTED' },
    });
    const view = await getAccountsView(uid);
    expect(view.combinableConnections).toHaveLength(1);
    const [p] = view.combinableConnections;
    expect(p.recommended.keepItemId).toBe('item-second');
    expect(p.recommended.dropItemId).toBe('item-first');
    // The old side stays choosable — depth reorders the default, it does not remove the choice.
    expect(p.alternative?.keepItemId).toBe('item-first');
    // The card can say what each side's feed holds (the depth-note wire, H.6c critic P1 #2).
    expect(p.recommended.keepEarliestTxnDate).toBe('2024-08-08');
    expect(p.recommended.dropEarliestTxnDate).toBeNull();
  });

  it('disconnects the losing connection and links the pair', async () => {
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res).toEqual({ ok: true, combined: 1, failures: [], revokeFailed: null });

    expect(await prisma.plaidItem.findMany({ where: { userId: uid }, select: { itemId: true } })).toEqual([
      { itemId: 'item-first' },
    ]);
    const link = await prisma.accountReconciliation.findFirstOrThrow({ where: { userId: uid } });
    expect(link.predecessorAccountId).toBe(`${uid}-a2`);
    expect(link.successorAccountId).toBe(`${uid}-a1`);
    expect(link.matchSignal).toBe('mask');
    // Cutover = the predecessor's last transaction, so it claims its own history and the
    // surviving row supplies everything outside that span.
    expect(link.cutoverDate).toBe('2026-07-20');
    expect(link.undoneAt).toBeNull();
  });

  it('keeps BOTH rows and both histories — nothing is deleted', async () => {
    await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(await prisma.account.count({ where: { userId: uid } })).toBe(2);
    expect(await prisma.transaction.count({ where: { account: { userId: uid } } })).toBe(2);
  });

  it('MONEY: the card stops counting twice on the page the owner is looking at', async () => {
    const before = await getAccountsView(uid);
    expect(before.liabilities.subtotalCents).toBe(853_909 * 2);

    await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );

    const after = await getAccountsView(uid);
    expect(after.liabilities.subtotalCents).toBe(853_909);
    // And the pair is no longer offered — it is resolved, not a standing proposal.
    expect(after.combinableConnections).toEqual([]);
    expect(after.reconciliations).toHaveLength(1);
  });

  it('the user can keep the OTHER connection instead', async () => {
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-second', dropItemId: 'item-first' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(true);
    const link = await prisma.accountReconciliation.findFirstOrThrow({ where: { userId: uid } });
    expect(link.predecessorAccountId).toBe(`${uid}-a1`);
    expect(link.successorAccountId).toBe(`${uid}-a2`);
  });

  it('leaves a finishable state if the link half fails after the disconnect', async () => {
    // Simulate the partial: disconnect only, no link. The recovery the failure copy promises is
    // that /accounts then OFFERS the pair as an ordinary continue-candidate.
    await fakeDisconnect(uid, 'item-second');
    const view = await getAccountsView(uid);
    expect(view.reconciliationCandidates).toHaveLength(1);
    const [c] = view.reconciliationCandidates;
    expect(c.predecessor.id).toBe(`${uid}-a2`);
    expect(c.successor.id).toBe(`${uid}-a1`);
  });
});

describe('demo golden-safety', () => {
  it('the seeded demo user is never offered a combine', async () => {
    const view = await getAccountsView('user-demo');
    expect(view.combinableConnections).toEqual([]);
  });
});

describe('one message per pair', () => {
  beforeEach(() => seed());

  it('the advisory duplicate warning steps aside for the pair that has a combine offer', async () => {
    const view = await getAccountsView(uid);
    expect(view.combinableConnections).toHaveLength(1);
    // #192's card would tell this same user to "disconnect one side" — which the offer above
    // already does in one tap. Two cards about one pair is noise, and they disagree on effort.
    expect(view.duplicates).toEqual([]);
  });

  it('and comes back if the pair stops being combinable', async () => {
    // A non-duplicate row under each connection makes BOTH directions strand something.
    await prisma.account.create({
      data: {
        id: `${uid}-a4`, userId: uid, provider: 'plaid', providerRef: 'acct-4', plaidItemId: 'item-first',
        name: 'CHECKING A', type: 'CHECKING', mask: '2222', subtype: 'checking', currentBalanceCents: 1, currency: 'USD',
      },
    });
    await prisma.account.create({
      data: {
        id: `${uid}-a5`, userId: uid, provider: 'plaid', providerRef: 'acct-5', plaidItemId: 'item-second',
        name: 'CHECKING B', type: 'CHECKING', mask: '3333', subtype: 'checking', currentBalanceCents: 2, currency: 'USD',
      },
    });
    const view = await getAccountsView(uid);
    expect(view.combinableConnections).toEqual([]);
    expect(view.duplicates).toHaveLength(1);
  });
});

describe('the critic findings, locked', () => {
  beforeEach(() => seed());

  it('test_regression__combine_keeps_the_live_feed’s_own_transactions', async () => {
    // Critic P0 (executed): with the handover placed at the OLD row's last transaction, every
    // row only the SURVIVING connection had — $890 of real charges — was dropped from the
    // register while the flash said "Done". The handover now sits just before the live feed's
    // own history starts, so the live feed keeps everything it pulled.
    await prisma.transaction.createMany({
      data: [
        // The old connection's history, including a day the live feed also has.
        { accountId: `${uid}-a2`, date: '2026-06-01', rawDescriptor: 'RENT', amountCents: -200_000, status: 'POSTED' },
        // The live connection: the same RENT day (a duplicate) plus two charges only it saw.
        { accountId: `${uid}-a1`, date: '2026-06-01', rawDescriptor: 'RENT', amountCents: -200_000, status: 'POSTED' },
        { accountId: `${uid}-a1`, date: '2026-06-15', rawDescriptor: 'SHELL OIL', amountCents: -5_000, status: 'POSTED' },
        { accountId: `${uid}-a1`, date: '2026-07-02', rawDescriptor: 'DELTA AIR', amountCents: -84_000, status: 'POSTED' },
      ],
    });

    await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );

    const { rows } = await getTransactions(uid);
    const descriptors = rows.map((r) => r.rawDescriptor).sort();
    expect(descriptors).toContain('SHELL OIL');
    expect(descriptors).toContain('DELTA AIR');
    // …and the duplicated days are counted once, which is the point of combining.
    expect(descriptors.filter((d) => d === 'RENT')).toHaveLength(1);
    expect(descriptors.filter((d) => d === 'COSTCO')).toHaveLength(1);
  });

  it('test_regression__two_opposite_combines_cannot_destroy_both_connections', async () => {
    // Critic P0 (executed, 3/3): the card renders both directions as live buttons; deriving the
    // plan outside a transaction let two taps each drop a different connection, leaving zero
    // connections, zero links and the duplicate still double-counting.
    const [a, b] = await Promise.all([
      combineDuplicateConnectionsFor(uid, { keepItemId: 'item-first', dropItemId: 'item-second' }, TODAY, fakeDisconnect),
      combineDuplicateConnectionsFor(uid, { keepItemId: 'item-second', dropItemId: 'item-first' }, TODAY, fakeDisconnect),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(1);
    const view = await getAccountsView(uid);
    expect(view.liabilities.subtotalCents).toBe(853_909);
  });

  it('test_regression__a_dismissed_pair_cannot_be_combined_by_a_stale_tab', async () => {
    // Critic P1 (executed): the view suppressed the offer after a dismissal; the action took it
    // anyway and severed a bank for a pair the user had said was NOT a duplicate.
    await prisma.nudgeDismissal.create({
      data: { userId: uid, dismissKey: duplicatePairDismissKey(`${uid}-a1`, `${uid}-a2`) },
    });
    expect((await getAccountsView(uid)).combinableConnections).toEqual([]);
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
  });

  it('test_regression__a_currency_withheld_pair_cannot_be_combined', async () => {
    // Same divergence, different blast radius: /accounts refuses to display these rows at all.
    await prisma.account.updateMany({ where: { userId: uid }, data: { currency: 'EUR' } });
    expect((await getAccountsView(uid)).combinableConnections).toEqual([]);
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
  });

  it('test_regression__an_existing_link_is_never_silently_re_targeted', async () => {
    await prisma.accountReconciliation.create({
      data: {
        userId: uid,
        predecessorAccountId: `${uid}-a1`,
        successorAccountId: `${uid}-a2`,
        cutoverDate: '2026-07-01',
        matchSignal: 'mask',
        confidence: 'high',
      },
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
  });
});

describe('the money-and-boundary critic findings, locked', () => {
  beforeEach(() => seed());

  it('test_regression__refuses_a_split_that_would_drop_a_charge_only_one_side_has', async () => {
    // Critic P0 (executed, both directions): a date split deduplicates two feeds only where they
    // actually agree. Here the surviving connection was broken for two days, so two real charges
    // exist ONLY on the connection about to be dropped — and the split would delete $930 of real
    // spending while reporting "Done".
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a2`, date: '2026-07-01', rawDescriptor: 'RENT', amountCents: -200_000, status: 'POSTED' },
        { accountId: `${uid}-a1`, date: '2026-07-01', rawDescriptor: 'RENT', amountCents: -200_000, status: 'POSTED' },
        { accountId: `${uid}-a2`, date: '2026-07-10', rawDescriptor: 'WHOLE FOODS', amountCents: -31_000, status: 'POSTED' },
        { accountId: `${uid}-a2`, date: '2026-07-11', rawDescriptor: 'UNITED AIR', amountCents: -62_000, status: 'POSTED' },
      ],
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('$930.00');
      expect(res.error).toContain('Nothing was changed');
    }
    // Nothing moved: both connections live, no link, both copies still counting.
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
    expect(await prisma.accountReconciliation.count({ where: { userId: uid } })).toBe(0);
    expect((await getTransactions(uid)).rows.map((r) => r.rawDescriptor)).toContain('WHOLE FOODS');
  });

  it('test_regression__a_hand_split_transaction_no_longer_blocks_the_combine (TASKS H.6b(b))', async () => {
    // Critic-executed (H.6 cycle 1): the no-loss guard read rows filtered `isSplitParent: false`,
    // so a predecessor that had been hand-SPLIT presented its children (−$60.00, −$40.00) where
    // the successor presents the bank's parent (−$100.00) — and the whole combine refused with
    // the FALSE diagnosis "charges appear on only one of them". A split is the reader's own
    // re-labelling of one bank charge (children share the parent's date and sum to its amount by
    // splitTransaction's validation), so the guard now compares the rows as the BANK delivered
    // them and a split no longer walls off the H.6 deepen remedy.
    const parent = await prisma.transaction.create({
      data: { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED', isSplitParent: true },
    });
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -6_000, status: 'POSTED', splitParentId: parent.id },
        { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -4_000, status: 'POSTED', splitParentId: parent.id },
        // The successor pulled the same charge unsplit, the way every fresh feed delivers it.
        { accountId: `${uid}-a1`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED' },
      ],
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res).toEqual({ ok: true, combined: 1, failures: [], revokeFailed: null });
    expect(await prisma.accountReconciliation.count({ where: { userId: uid } })).toBe(1);
  });

  it('test_regression__a_split_does_not_mask_a_charge_the_other_side_genuinely_lacks', async () => {
    // The other direction of the same fix, so the bank-shape read cannot drift into leniency: a
    // split PARENT inside the successor's own era, with NO copy on the successor, is still real
    // money the date split would drop — the guard must refuse exactly as it would for an
    // unsplit row, and name the bank's amount ($100.00), not the pieces.
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a2`, date: '2026-06-15', rawDescriptor: 'OLD CHARGE', amountCents: -700, status: 'POSTED' },
        { accountId: `${uid}-a1`, date: '2026-07-01', rawDescriptor: 'FIRST SEEN', amountCents: -500, status: 'POSTED' },
      ],
    });
    const parent = await prisma.transaction.create({
      data: { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED', isSplitParent: true },
    });
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -6_000, status: 'POSTED', splitParentId: parent.id },
        { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -4_000, status: 'POSTED', splitParentId: parent.id },
      ],
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('$100.00');
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
    expect(await prisma.accountReconciliation.count({ where: { userId: uid } })).toBe(0);
  });

  it('test_regression__a_pending_posted_drifted_split_no_longer_deletes_the_charge (H.6b(b) critic P0)', async () => {
    // The critic's executed P0 against the first bank-shape guard: the pending→posted sync moves
    // the PARENT to the posted date and leaves the children at the pending date (plaid.ts, both
    // the preserve branch and the id-churn transplant), so "children share the parent's date"
    // is false in production. With the window then computed from the bank-shape subset, the
    // combine passed the guard and every copy of a real $100.00 charge stopped counting.
    // The window now comes from ALL rows exactly as the boundary computes it, so this shape
    // combines AND conserves the money — the children keep counting on the kept side.
    const parent = await prisma.transaction.create({
      data: {
        accountId: `${uid}-a1`, providerRef: 'pl-dinner', date: '2026-07-20',
        rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED', isSplitParent: true,
      },
    });
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a1`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -6_000, status: 'POSTED', splitParentId: parent.id },
        { accountId: `${uid}-a1`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -4_000, status: 'POSTED', splitParentId: parent.id },
        // The dropped side is deeper AND holds its own posted copy of the same charge.
        { accountId: `${uid}-a2`, date: '2026-06-01', rawDescriptor: 'RENT', amountCents: -200_000, status: 'POSTED' },
        { accountId: `${uid}-a2`, date: '2026-07-20', rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED' },
      ],
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res).toEqual({ ok: true, combined: 1, failures: [], revokeFailed: null });
    const { rows } = await getTransactions(uid);
    const dinner = rows.filter((r) => r.rawDescriptor === 'DINNER');
    // The reader's split pieces still count — $100.00 exactly once, as two pieces.
    expect(dinner.map((r) => r.amountCents).sort()).toEqual([-6_000, -4_000].sort());
    expect(rows.map((r) => r.rawDescriptor)).toContain('RENT');
  });

  it('test_regression__a_split_severed_by_the_handover_refuses_instead_of_double_counting (H.6b(b) critic P0, mirror)', async () => {
    // Same drifted shape on the DROPPED side: its children (pending date) fall inside the claim
    // window and keep counting, while the kept side's posted copy also counts — a silent double.
    // The severed-family check refuses the whole combine, fail closed.
    const parent = await prisma.transaction.create({
      data: {
        accountId: `${uid}-a2`, providerRef: 'pl-dinner-2', date: '2026-07-20',
        rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED', isSplitParent: true,
      },
    });
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -6_000, status: 'POSTED', splitParentId: parent.id },
        { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -4_000, status: 'POSTED', splitParentId: parent.id },
        { accountId: `${uid}-a2`, date: '2026-06-01', rawDescriptor: 'RENT', amountCents: -200_000, status: 'POSTED' },
        { accountId: `${uid}-a1`, date: '2026-07-20', rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED' },
      ],
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('split');
      expect(res.error).toContain('Nothing was changed');
    }
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
    expect(await prisma.accountReconciliation.count({ where: { userId: uid } })).toBe(0);
  });

  it('test_regression__a_dangling_split_child_is_counted_money_the_guard_protects (H.6b(b) critic P1)', async () => {
    // `splitParentId` has no FK, and the sync's dissolve path has historically dangled children.
    // The register counts a dangling child as real money, so the guard must too — the critic
    // executed the version that ignored it: $60.00 vanished behind an ok:true.
    await prisma.transaction.create({
      data: {
        accountId: `${uid}-a2`, date: '2026-07-21', rawDescriptor: 'ORPHAN PIECE',
        amountCents: -6_000, status: 'POSTED', splitParentId: 'ghost-parent-id',
      },
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('$60.00');
    expect(await prisma.plaidItem.count({ where: { userId: uid } })).toBe(2);
  });

  it('test_regression__a_split_on_the_KEPT_side_is_read_in_bank_shape_too (H.6b(b) critic P1)', async () => {
    // The successor-side half of the bank-shape read was completely unlocked — the critic
    // reverted it alone and 33 tests stayed green, while the false-refusal defect this fix
    // exists for came straight back on a kept-side split.
    const parent = await prisma.transaction.create({
      data: {
        accountId: `${uid}-a1`, providerRef: 'pl-dinner-3', date: '2026-07-18',
        rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED', isSplitParent: true,
      },
    });
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a1`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -6_000, status: 'POSTED', splitParentId: parent.id },
        { accountId: `${uid}-a1`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -4_000, status: 'POSTED', splitParentId: parent.id },
        { accountId: `${uid}-a2`, date: '2026-07-18', rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED' },
      ],
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res).toEqual({ ok: true, combined: 1, failures: [], revokeFailed: null });
    // Money conserved: the charge counts exactly once ($100.00) — here as the predecessor's
    // pre-cutover copy, since the claim window owns that day.
    const { rows } = await getTransactions(uid);
    const dinner = rows.filter((r) => r.rawDescriptor === 'DINNER');
    expect(dinner.reduce((s, r) => s + r.amountCents, 0)).toBe(-10_000);
  });

  it('the deep-history refusal names the true remedy: combine the other way round (H.6c critic P1)', async () => {
    // When every missing charge sits on the connection the reader chose to DROP and the
    // opposite direction is offered, "sync and try again" is permanently false and "delete the
    // copy you don't want" points at deleting real history. The refusal now names the remedy
    // that actually works.
    await prisma.transaction.createMany({
      data: [
        // The kept side's history starts EARLIER, so the handover clamps to the dropped side's
        // own first row and almost everything after it falls outside the one-day claim…
        { accountId: `${uid}-a1`, date: '2026-06-01', rawDescriptor: 'EARLY', amountCents: -5_000, status: 'POSTED' },
        { accountId: `${uid}-a2`, date: '2026-07-10', rawDescriptor: 'WHOLE FOODS', amountCents: -31_000, status: 'POSTED' },
        // …including this charge, which exists ONLY on the connection being dropped.
        { accountId: `${uid}-a2`, date: '2026-07-11', rawDescriptor: 'UNITED AIR', amountCents: -62_000, status: 'POSTED' },
      ],
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('$620.00');
      expect(res.error).toContain('combine the other way round');
      expect(res.error).not.toContain('delete the copy');
    }
  });

  it('test_regression__autopay_follows_the_account_when_its_connection_is_dropped', async () => {
    // Critic P1 (executed): the dropped row's autopay was filtered out with it, so /cards said
    // "move $8,539.09 yourself" while the bank still pulled it — a double payment.
    await prisma.autopayConfig.create({
      data: { accountId: `${uid}-a2`, mode: 'STATEMENT_BALANCE', fixedAmountCents: null },
    });
    const res = await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect(res.ok).toBe(true);
    const survivor = await prisma.autopayConfig.findUnique({ where: { accountId: `${uid}-a1` } });
    expect(survivor?.mode).toBe('STATEMENT_BALANCE');
  });

  it('test_regression__the_user_s_own_autopay_on_the_surviving_row_is_never_overwritten', async () => {
    await prisma.autopayConfig.createMany({
      data: [
        { accountId: `${uid}-a2`, mode: 'STATEMENT_BALANCE' },
        { accountId: `${uid}-a1`, mode: 'MINIMUM' },
      ],
    });
    await combineDuplicateConnectionsFor(
      uid,
      { keepItemId: 'item-first', dropItemId: 'item-second' },
      TODAY,
      fakeDisconnect,
    );
    expect((await prisma.autopayConfig.findUnique({ where: { accountId: `${uid}-a1` } }))?.mode).toBe('MINIMUM');
  });

  it('test_regression__a_third_connection_at_one_bank_can_still_be_combined', async () => {
    // Critic P1 (executed): blocking any account already inside a link blocked the SUCCESSOR too,
    // so after the first combine the third connection had no offer and the user was left still
    // double-counting, with a refusal message asserting something untrue.
    await prisma.plaidItem.create({
      data: {
        userId: uid,
        itemId: 'item-third',
        accessToken: 'enc:third',
        institution: 'Chase',
        institutionId: 'ins_56',
        lastSyncedAt: '2026-07-24',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    await prisma.account.create({
      data: {
        id: `${uid}-a3`, userId: uid, provider: 'plaid', providerRef: 'acct-3', plaidItemId: 'item-third',
        name: 'CREDIT CARD', type: 'CREDIT', mask: '0977', subtype: 'credit card',
        currentBalanceCents: 853_909, currency: 'USD',
      },
    });
    expect((await getAccountsView(uid)).liabilities.subtotalCents).toBe(853_909 * 3);

    const first = await combineDuplicateConnectionsFor(
      uid, { keepItemId: 'item-first', dropItemId: 'item-second' }, TODAY, fakeDisconnect,
    );
    expect(first.ok).toBe(true);
    const second = await combineDuplicateConnectionsFor(
      uid, { keepItemId: 'item-first', dropItemId: 'item-third' }, TODAY, fakeDisconnect,
    );
    expect(second.ok).toBe(true);
    expect((await getAccountsView(uid)).liabilities.subtotalCents).toBe(853_909);
  });
});

describe('when the app will NOT offer a combine, it says why', () => {
  beforeEach(() => seed());

  it('names the missing bank ID — the reason the owner saw nothing at all', async () => {
    // The ladder refuses to scope a comparison it cannot place at ONE institution, so a
    // connection linked before the institutionId column existed blocks the offer until the
    // ordinary sweep fills it in. Rendering nothing there is what made the whole feature look
    // like it had not shipped.
    await prisma.plaidItem.update({ where: { itemId: 'item-second' }, data: { institutionId: null } });
    const view = await getAccountsView(uid);
    expect(view.combinableConnections).toEqual([]);
    expect(view.uncombinableConnections).toHaveLength(1);
    expect(view.uncombinableConnections[0].kind).toBe('bank-id-missing');
    expect(view.uncombinableConnections[0].lookalikes[0]).toEqual({ name: 'CREDIT CARD', mask: '0977' });
  });

  it('names a dismissal, and carries the pair a "reconsider" control would restore', async () => {
    await prisma.nudgeDismissal.create({
      data: { userId: uid, dismissKey: duplicatePairDismissKey(`${uid}-a1`, `${uid}-a2`) },
    });
    const view = await getAccountsView(uid);
    expect(view.combinableConnections).toEqual([]);
    const [blocked] = view.uncombinableConnections;
    expect(blocked.kind).toBe('dismissed');
    expect(blocked.dismissedPair).not.toBeNull();
    expect([blocked.dismissedPair?.aId, blocked.dismissedPair?.bId].sort()).toEqual(
      [`${uid}-a1`, `${uid}-a2`].sort(),
    );
  });

  it('names what would be stranded when neither direction is safe', async () => {
    await prisma.account.createMany({
      data: [
        { id: `${uid}-x1`, userId: uid, provider: 'plaid', providerRef: 'x1', plaidItemId: 'item-first',
          name: 'CHECKING A', type: 'CHECKING', mask: '2222', subtype: 'checking', currentBalanceCents: 10, currency: 'USD' },
        { id: `${uid}-x2`, userId: uid, provider: 'plaid', providerRef: 'x2', plaidItemId: 'item-second',
          name: 'CHECKING B', type: 'CHECKING', mask: '3333', subtype: 'checking', currentBalanceCents: 20, currency: 'USD' },
      ],
    });
    const view = await getAccountsView(uid);
    expect(view.combinableConnections).toEqual([]);
    const [blocked] = view.uncombinableConnections;
    expect(blocked.kind).toBe('strands');
    expect([...blocked.strandedAccountNames].sort()).toEqual(['CHECKING A ····2222', 'CHECKING B ····3333']);
  });

  it('stays quiet when there IS an offer — the offer is the answer', async () => {
    const view = await getAccountsView(uid);
    expect(view.combinableConnections).toHaveLength(1);
    expect(view.uncombinableConnections).toEqual([]);
  });

  it('stays quiet for the demo account', async () => {
    expect((await getAccountsView('user-demo')).uncombinableConnections).toEqual([]);
  });
});

describe('H.6b(a) — the reader’s hand-filed work follows the account across the combine', () => {
  beforeEach(() => seed());

  /** The deepen shape through the REAL action: the kept connection (item-first) is the new deep
   *  side (history from 06-01); the dropped connection (item-second) is the old shallow side
   *  (history from 07-10), so the handover clamps to 07-10 and everything the old side recorded
   *  after its first day is disowned. The base seed's COSTCO 07-20 copy on the dropped side is
   *  disowned too — carried as a no-op. */
  async function seedDeepen() {
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a1`, date: '2026-06-01', rawDescriptor: 'EARLY', amountCents: -5_000, status: 'POSTED' },
        { accountId: `${uid}-a2`, date: '2026-07-10', rawDescriptor: 'RENT', amountCents: -200_000, status: 'POSTED' },
        { accountId: `${uid}-a2`, date: '2026-07-11', rawDescriptor: 'WHOLE FOODS', amountCents: -31_000, status: 'POSTED' },
        { accountId: `${uid}-a1`, date: '2026-07-11', rawDescriptor: 'WHOLE FOODS', amountCents: -31_000, status: 'POSTED' },
      ],
    });
  }

  it('carries the reader’s filing on the dropped copies onto the survivor', async () => {
    await seedDeepen();
    const wf = await prisma.transaction.findFirstOrThrow({ where: { accountId: `${uid}-a2`, date: '2026-07-11' } });
    await prisma.transaction.update({
      where: { id: wf.id },
      data: { categoryId: 'groceries', note: 'weekly shop', taxClass: 'FOOD', confidenceBps: 10_000, needsReview: false },
    });
    await prisma.correction.create({ data: { userId: uid, transactionId: wf.id, toCategoryId: 'groceries' } });

    const res = await combineDuplicateConnectionsFor(
      uid, { keepItemId: 'item-first', dropItemId: 'item-second' }, TODAY, fakeDisconnect,
    );
    expect(res).toEqual({ ok: true, combined: 1, failures: [], revokeFailed: null });

    const survivor = await prisma.transaction.findFirstOrThrow({ where: { accountId: `${uid}-a1`, date: '2026-07-11' } });
    expect(survivor.categoryId).toBe('groceries');
    expect(survivor.note).toBe('weekly shop');
    expect(survivor.taxClass).toBe('FOOD');
    expect(survivor.needsReview).toBe(false);
    // The Correction MOVED with the decision — never copied (a copy would double the learner's
    // evidence, H.8 residual-2), never stacked onto the survivor's own chain.
    expect(await prisma.correction.count({ where: { transactionId: wf.id } })).toBe(0);
    expect(await prisma.correction.count({ where: { transactionId: survivor.id } })).toBe(1);
    // The kept predecessor day (the deepen's own first day) is untouched — its filing already
    // applies, no carry needed.
    const rent = await prisma.transaction.findFirstOrThrow({ where: { accountId: `${uid}-a2`, date: '2026-07-10' } });
    expect(rent.categoryId).toBeNull();
    expect(await prisma.correction.count({ where: { transactionId: rent.id } })).toBe(0);
    // The register reads the charge once, on the survivor, and nothing else moved.
    const { rows } = await getTransactions(uid);
    expect(rows.filter((r) => r.rawDescriptor === 'WHOLE FOODS')).toHaveLength(1);
    expect(rows.map((r) => r.rawDescriptor).sort()).toEqual(['COSTCO', 'EARLY', 'RENT', 'WHOLE FOODS']);
  });

  it('the survivor’s own reader values win — and never get a correction chain stacked onto them', async () => {
    await seedDeepen();
    const pred = await prisma.transaction.findFirstOrThrow({ where: { accountId: `${uid}-a2`, date: '2026-07-11' } });
    const succ = await prisma.transaction.findFirstOrThrow({ where: { accountId: `${uid}-a1`, date: '2026-07-11' } });
    await prisma.transaction.update({ where: { id: pred.id }, data: { categoryId: 'groceries', note: 'old note', needsReview: false } });
    await prisma.correction.create({ data: { userId: uid, transactionId: pred.id, toCategoryId: 'groceries' } });
    // The reader filed the survivor copy too — their own later decision wins.
    await prisma.transaction.update({ where: { id: succ.id }, data: { categoryId: 'dining', note: 'new note', needsReview: false } });
    await prisma.correction.create({ data: { userId: uid, transactionId: succ.id, toCategoryId: 'dining' } });

    const res = await combineDuplicateConnectionsFor(
      uid, { keepItemId: 'item-first', dropItemId: 'item-second' }, TODAY, fakeDisconnect,
    );
    expect(res.ok).toBe(true);

    const survivor = await prisma.transaction.findFirstOrThrow({ where: { id: succ.id } });
    expect(survivor.categoryId).toBe('dining');
    expect(survivor.note).toBe('new note');
    expect(await prisma.correction.count({ where: { transactionId: succ.id } })).toBe(1);
    expect(await prisma.correction.count({ where: { transactionId: pred.id } })).toBe(1);
  });

  it('the reader’s verdict outranks the survivor’s engine guess', async () => {
    await seedDeepen();
    const pred = await prisma.transaction.findFirstOrThrow({ where: { accountId: `${uid}-a2`, date: '2026-07-11' } });
    const succ = await prisma.transaction.findFirstOrThrow({ where: { accountId: `${uid}-a1`, date: '2026-07-11' } });
    await prisma.transaction.update({ where: { id: pred.id }, data: { categoryId: 'groceries', needsReview: false } });
    await prisma.correction.create({ data: { userId: uid, transactionId: pred.id, toCategoryId: 'groceries' } });
    // The survivor's fresh copy was auto-filed by the pipeline — engine guess, no Correction.
    await prisma.transaction.update({
      where: { id: succ.id },
      data: { categoryId: 'utilities', confidenceBps: 5_000, needsReview: false },
    });

    const res = await combineDuplicateConnectionsFor(
      uid, { keepItemId: 'item-first', dropItemId: 'item-second' }, TODAY, fakeDisconnect,
    );
    expect(res.ok).toBe(true);

    const survivor = await prisma.transaction.findFirstOrThrow({ where: { id: succ.id } });
    expect(survivor.categoryId).toBe('groceries');
    expect(survivor.needsReview).toBe(false);
    expect(await prisma.correction.count({ where: { transactionId: succ.id } })).toBe(1);
  });

  it('a hand-split family on the dropped side is re-created under the survivor', async () => {
    await seedDeepen();
    const parent = await prisma.transaction.create({
      data: { accountId: `${uid}-a2`, date: '2026-07-15', rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED', isSplitParent: true },
    });
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a2`, date: '2026-07-15', rawDescriptor: 'DINNER', amountCents: -6_000, status: 'POSTED', splitParentId: parent.id, categoryId: 'groceries', needsReview: false },
        { accountId: `${uid}-a2`, date: '2026-07-15', rawDescriptor: 'DINNER', amountCents: -4_000, status: 'POSTED', splitParentId: parent.id, categoryId: 'dining', needsReview: false },
        { accountId: `${uid}-a1`, date: '2026-07-15', rawDescriptor: 'DINNER', amountCents: -10_000, status: 'POSTED' },
      ],
    });

    const res = await combineDuplicateConnectionsFor(
      uid, { keepItemId: 'item-first', dropItemId: 'item-second' }, TODAY, fakeDisconnect,
    );
    expect(res).toEqual({ ok: true, combined: 1, failures: [], revokeFailed: null });

    const container = await prisma.transaction.findFirstOrThrow({
      where: { accountId: `${uid}-a1`, rawDescriptor: 'DINNER', isSplitParent: true },
    });
    expect(container.amountCents).toBe(-10_000);
    const pieces = await prisma.transaction.findMany({ where: { splitParentId: container.id } });
    const byAmount = new Map(pieces.map((p) => [p.amountCents, p.categoryId]));
    expect(byAmount.size).toBe(2);
    expect(byAmount.get(-6_000)).toBe('groceries');
    expect(byAmount.get(-4_000)).toBe('dining');
    expect(pieces.reduce((s, p) => s + p.amountCents, 0)).toBe(-10_000);
    // The register counts the charge exactly once, as the reader's two pieces.
    const { rows } = await getTransactions(uid);
    const dinner = rows.filter((r) => r.rawDescriptor === 'DINNER');
    expect(dinner.map((r) => r.amountCents).sort()).toEqual([-6_000, -4_000].sort());
  });

  it('two identical same-day charges on both sides are carried for neither — never guess', async () => {
    await seedDeepen();
    await prisma.transaction.createMany({
      data: [
        { accountId: `${uid}-a2`, date: '2026-07-16', rawDescriptor: 'STARBUCKS', amountCents: -1_200, status: 'POSTED' },
        { accountId: `${uid}-a2`, date: '2026-07-16', rawDescriptor: 'STARBUCKS', amountCents: -1_200, status: 'POSTED' },
        { accountId: `${uid}-a1`, date: '2026-07-16', rawDescriptor: 'STARBUCKS', amountCents: -1_200, status: 'POSTED' },
        { accountId: `${uid}-a1`, date: '2026-07-16', rawDescriptor: 'STARBUCKS', amountCents: -1_200, status: 'POSTED' },
      ],
    });
    const filed = await prisma.transaction.findFirstOrThrow({ where: { accountId: `${uid}-a2`, date: '2026-07-16' } });
    await prisma.transaction.update({ where: { id: filed.id }, data: { categoryId: 'groceries', needsReview: false } });
    await prisma.correction.create({ data: { userId: uid, transactionId: filed.id, toCategoryId: 'groceries' } });

    const res = await combineDuplicateConnectionsFor(
      uid, { keepItemId: 'item-first', dropItemId: 'item-second' }, TODAY, fakeDisconnect,
    );
    expect(res).toEqual({ ok: true, combined: 1, failures: [], revokeFailed: null });

    // The carry refused to guess which survivor is which: neither receives the filing, and no
    // correction moved — the combine itself is never blocked by the ambiguity.
    const survivors = await prisma.transaction.findMany({ where: { accountId: `${uid}-a1`, date: '2026-07-16' } });
    for (const s of survivors) expect(s.categoryId).toBeNull();
    expect(await prisma.correction.count({ where: { transactionId: { in: survivors.map((s) => s.id) } } })).toBe(0);
  });
});

describe('buildCombineInputs — the per-connection depth fold (H.6c critic P1: it was unlocked)', () => {
  // A bank connection normally carries SEVERAL accounts (checking + card is the ordinary case),
  // and the critic inverted the fold (min → max) with every suite green because all shipped
  // fixtures gave each connection exactly one account. The connection's depth is its OLDEST
  // account floor — the deepest thing its feed reached — never the newest or the last written.
  const item = {
    itemId: 'item-multi',
    institution: 'Chase',
    institutionId: 'ins_56',
    lastSyncedAt: '2026-07-24',
    lastSyncError: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const acct = (id: string, provider = 'plaid') => ({
    id,
    name: id.toUpperCase(),
    provider,
    plaidItemId: provider === 'plaid' ? 'item-multi' : null,
    mask: '0977',
    type: 'CREDIT',
    subtype: 'credit card',
    currency: 'USD',
    persistentAccountId: null,
    institutionId: 'ins_56',
    institutionName: 'Chase',
  });

  it('folds to the OLDEST account floor across the connection, regardless of account order', () => {
    const map = new Map([
      ['chk', '2026-05-01'],
      ['card', '2024-08-08'],
    ]);
    const oneWay = buildCombineInputs([item], [acct('chk'), acct('card')], map);
    const otherWay = buildCombineInputs([item], [acct('card'), acct('chk')], map);
    expect(oneWay.engineItems[0].earliestTxnDate).toBe('2024-08-08');
    expect(otherWay.engineItems[0].earliestTxnDate).toBe('2024-08-08');
  });

  it('ignores non-plaid accounts and reads null when no account has a floor', () => {
    const map = new Map([['sf-acct', '2020-01-01']]);
    const { engineItems } = buildCombineInputs([item], [acct('chk'), acct('sf-acct', 'simplefin')], map);
    expect(engineItems[0].earliestTxnDate).toBeNull();
  });
});
