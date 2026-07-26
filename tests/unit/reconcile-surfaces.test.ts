/**
 * Wave 4.6 slice 6 — the full-surface hostile-critic fixes, locked.
 *
 * The critics' headline: the boundary was right but not EVERYWHERE — the register
 * (/transactions), CSV export, budgets, triage, and recurring detection read Prisma
 * directly and double-counted a reconciled pair's overlap rows, while manual writes
 * to a superseded predecessor silently vanished from every sum. The fix is ONE
 * shared rule (`getReconciliationTxnKeep`, the assembler's exact R1 closure), so
 * these tests lock the rule + the register (the main money display) + the fold/fence
 * helpers each surface consumes:
 *
 *   B-F1/C-1  register rows AND summary count each real transaction once
 *   B-F2/C-4  manual/CSV writes to a superseded predecessor are refused
 *   C-5       assistant account-balance folds a predecessor onto its live successor
 *   C-8       a predecessor already in an active link is never re-offered as a candidate
 *   C-10      two PlaidItems' rows for the same bank are duplicate-eligible
 *   A-F7      /accounts returns the boundary-remapped paymentAccountId
 *   C-12      candidates carry the predecessor's txn span (cutover default/min + honest copy)
 *
 * Real-Prisma harness mirrors reconcile-accounts-view.test.ts (throwaway users, wipe
 * around, reconciliation rows reset per test).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getAccountsView, getTransactions } from '@/server/transactions';
import { getReconciliationTxnKeep, refuseManualWriteToSuperseded } from '@/server/reconciliation';
import { answerAccountBalance } from '@/lib/engine/assistant/answer';
import { terminalSuccessorMap } from '@/lib/engine/account/reconcile-boundary';
import { detectDuplicateAccounts } from '@/lib/engine/account/duplicates';
import { duplicatePairDismissKey } from '@/server/duplicate-dismissal';

const STAMP = `${Date.now()}-${process.pid}`;
const OWNER = `sx-owner-${STAMP}`; // register + fence + payment-remap fixture
const TRIO = `sx-trio-${STAMP}`; // C-8 fixture: one stale pred, TWO live twins
const FOLD = `sx-fold-${STAMP}`; // L.9 critic P1: a folded predecessor that came back LIVE
const ALL_USERS = [OWNER, TRIO, FOLD];

let ownerPred = '';
let ownerSucc = '';
let trioPred = '';
let trioLiveB = '';
let trioLiveC = '';
let foldP = ''; // simplefin — reconnected, so LIVE, and an effective predecessor of foldS
let foldS = ''; // plaid live successor
let foldX = ''; // manual stale row matching both

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.createMany({ data: ALL_USERS.map((id) => ({ id, email: `${id}@test.local` })) });

  // OWNER: disconnected SimpleFIN pred + live Plaid succ, overlapping May–June history.
  ownerPred = (
    await prisma.account.create({
      data: { userId: OWNER, provider: 'simplefin', providerRef: 'sf-sx', name: 'Chase Checking (old)', type: 'CHECKING', mask: '1234', currency: 'USD', currentBalanceCents: 240_000 },
    })
  ).id;
  await prisma.plaidItem.create({ data: { userId: OWNER, itemId: `sx-item-${STAMP}`, accessToken: 'ct-sx' } });
  ownerSucc = (
    await prisma.account.create({
      data: { userId: OWNER, provider: 'plaid', providerRef: 'pl-sx', plaidItemId: `sx-item-${STAMP}`, name: 'Chase Checking', type: 'CHECKING', mask: '1234', currency: 'USD', currentBalanceCents: 250_000 },
    })
  ).id;
  // One real purchase per date; the succ re-imports the pred's two purchases.
  await prisma.transaction.createMany({
    data: [
      { accountId: ownerPred, providerRef: 'p1', date: '2026-05-01', amountCents: -5_000, rawDescriptor: 'COFFEE', status: 'POSTED' },
      { accountId: ownerPred, providerRef: 'p2', date: '2026-06-10', amountCents: -7_000, rawDescriptor: 'GROCERY', status: 'POSTED' },
      { accountId: ownerSucc, providerRef: 's1', date: '2026-05-01', amountCents: -5_000, rawDescriptor: 'COFFEE', status: 'POSTED' },
      { accountId: ownerSucc, providerRef: 's2', date: '2026-06-10', amountCents: -7_000, rawDescriptor: 'GROCERY', status: 'POSTED' },
      { accountId: ownerSucc, providerRef: 's3', date: '2026-07-01', amountCents: -3_000, rawDescriptor: 'GAS', status: 'POSTED' },
    ],
  });

  // TRIO: stale SimpleFIN pred + two live Plaid twins on DIFFERENT items, same mask.
  trioPred = (
    await prisma.account.create({
      data: { userId: TRIO, provider: 'simplefin', providerRef: 'sf-3', name: 'BofA Checking (old)', type: 'CHECKING', mask: '5678', currency: 'USD', currentBalanceCents: 100_000 },
    })
  ).id;
  await prisma.plaidItem.createMany({
    data: [
      { userId: TRIO, itemId: `sx3-b-${STAMP}`, accessToken: 'ct-b' },
      { userId: TRIO, itemId: `sx3-c-${STAMP}`, accessToken: 'ct-c' },
    ],
  });
  trioLiveB = (
    await prisma.account.create({
      data: { userId: TRIO, provider: 'plaid', providerRef: 'pl-b', plaidItemId: `sx3-b-${STAMP}`, name: 'BofA Checking', type: 'CHECKING', mask: '5678', currency: 'USD', currentBalanceCents: 100_000 },
    })
  ).id;
  trioLiveC = (
    await prisma.account.create({
      data: { userId: TRIO, provider: 'plaid', providerRef: 'pl-c', plaidItemId: `sx3-c-${STAMP}`, name: 'BofA Checking', type: 'CHECKING', mask: '5678', currency: 'USD', currentBalanceCents: 100_000 },
    })
  ).id;

  // FOLD (L.9 critic P1-1, executed there first): P was reconciled into S while stale, then its
  // SimpleFIN connection was re-added — so P is LIVE AGAIN while remaining zeroed, folded, and
  // client-filtered off the account list. X is a still-older manual copy matching both.
  await prisma.simpleFinConnection.create({ data: { userId: FOLD, accessUrl: 'ct-fold' } });
  foldP = (
    await prisma.account.create({
      data: { userId: FOLD, provider: 'simplefin', providerRef: 'sf-fold', name: 'Chase Checking (old)', type: 'CHECKING', mask: '1234', currency: 'USD', currentBalanceCents: 240_000 },
    })
  ).id;
  await prisma.plaidItem.create({ data: { userId: FOLD, itemId: `sx-fold-item-${STAMP}`, accessToken: 'ct-folds' } });
  foldS = (
    await prisma.account.create({
      data: { userId: FOLD, provider: 'plaid', providerRef: 'pl-fold', plaidItemId: `sx-fold-item-${STAMP}`, name: 'Chase Checking', type: 'CHECKING', mask: '1234', currency: 'USD', currentBalanceCents: 250_000 },
    })
  ).id;
  foldX = (
    await prisma.account.create({
      data: { userId: FOLD, provider: 'manual', providerRef: 'man-fold', name: 'Chase Checking (older)', type: 'CHECKING', mask: null, currency: 'USD', currentBalanceCents: 230_000 },
    })
  ).id;
});

afterEach(async () => {
  await prisma.accountReconciliation.deleteMany({ where: { userId: { in: ALL_USERS } } });
  await prisma.nudgeDismissal.deleteMany({ where: { userId: { in: ALL_USERS } } });
});

afterAll(wipe);

async function link(cutoverDate = '2026-06-30') {
  await prisma.accountReconciliation.create({
    data: { userId: OWNER, predecessorAccountId: ownerPred, successorAccountId: ownerSucc, cutoverDate, matchSignal: 'mask', confidence: 'high' },
  });
}

describe('B-F1/C-1 — the register applies the boundary', () => {
  it('pre-link: both copies show (today’s behavior, the advisory covers it)', async () => {
    const reg = await getTransactions(OWNER);
    expect(reg.summary.count).toBe(5);
    expect(reg.summary.outflowCents).toBe(27_000);
  });

  it('linked: rows AND summary count each real transaction once, matching the snapshot', async () => {
    await link();
    const reg = await getTransactions(OWNER);
    const keys = reg.rows.map((r) => `${r.accountId === ownerPred ? 'pred' : 'succ'}:${r.date}:${r.amountCents}`).sort();
    // Pred owns its claim span [05-01, 06-10]; succ keeps outside it.
    expect(keys).toEqual(['pred:2026-05-01:-5000', 'pred:2026-06-10:-7000', 'succ:2026-07-01:-3000']);
    expect(reg.summary.count).toBe(3);
    expect(reg.summary.outflowCents).toBe(15_000); // pre-fix: 27_000 — an 80% inflation
  });

  it('the shared keep-rule is the R8 fast path with no links (keeps everything, zero extra queries)', async () => {
    const keep = await getReconciliationTxnKeep(OWNER);
    expect(keep(ownerPred, '2026-06-10')).toBe(true);
    expect(keep(ownerSucc, '2026-06-10')).toBe(true);
  });

  it('the shared keep-rule matches the assembler split when linked', async () => {
    await link();
    const keep = await getReconciliationTxnKeep(OWNER);
    expect(keep(ownerPred, '2026-06-10')).toBe(true); // pred inside claim → keeps
    expect(keep(ownerSucc, '2026-06-10')).toBe(false); // succ copy inside claim → dropped
    expect(keep(ownerSucc, '2026-07-01')).toBe(true); // succ outside claim → keeps
    expect(keep(ownerPred, '2026-07-15')).toBe(false); // pred after cutover → dropped
  });
});

describe('B-F2/C-4 — manual writes to a superseded predecessor are refused', () => {
  it('refuses the predecessor, allows the successor and unlinked accounts', async () => {
    await link();
    expect(await refuseManualWriteToSuperseded(OWNER, ownerPred)).toMatch(/combined into/);
    expect(await refuseManualWriteToSuperseded(OWNER, ownerSucc)).toBeNull();
    expect(await refuseManualWriteToSuperseded(TRIO, trioPred)).toBeNull(); // other user, no link
  });

  it('undo lifts the fence (R9)', async () => {
    await link();
    await prisma.accountReconciliation.updateMany({ where: { userId: OWNER }, data: { undoneAt: new Date() } });
    expect(await refuseManualWriteToSuperseded(OWNER, ownerPred)).toBeNull();
  });
});

describe('C-8 — an already-linked predecessor is never re-offered (and its pairs never warn)', () => {
  it('pre-link: one stale row matching TWO live accounts offers NEITHER — the group is carried out as ambiguous (L.9)', async () => {
    // This assertion previously locked the OLD behaviour ("BOTH live twins are offered as
    // candidates") — the exact shape TASKS L.9 was opened to remove: two identically-badged
    // Combine cards, one tap away from folding the wrong history. The pair is now withheld
    // and stated instead (a filter that discards an unknown must carry it out).
    const view = await getAccountsView(TRIO);
    expect(view.reconciliationCandidates).toHaveLength(0);
    expect(view.reconciliationAmbiguities).toHaveLength(1);
    expect(view.reconciliationAmbiguities[0].predecessor.id).toBe(trioPred);
    expect(new Set(view.reconciliationAmbiguities[0].successors.map((s) => s.id))).toEqual(
      new Set([trioLiveB, trioLiveC]),
    );
    // The invariant the card's how-to rests on (cycle-2 P2-5): EVERY pair in a rendered group is
    // on the duplicate notice, so the "Not a duplicate" control it names exists for each of them.
    // Proven pairs leave groups via the offer hoist; every notice filter is mirrored in the
    // engine's excludePair — so this holds by construction, and this lock proves it end-to-end.
    const noticePairs = new Set(view.duplicates.map((d) => [d.a.id, d.b.id].sort().join('|')));
    for (const s of view.reconciliationAmbiguities[0].successors) {
      expect(noticePairs.has([trioPred, s.id].sort().join('|'))).toBe(true);
    }
  });

  it('pre-link: dismissing the WRONG twin releases the survivor as the single candidate (L.9 excludePair)', async () => {
    // The user's resolution path: the ambiguous pairs still fire the #192 warning (no candidate
    // suppresses them), so the duplicate-warning card offers "Not a duplicate" per pair. Dismissing
    // pred↔C must release pred↔B — a post-filter would leave B withheld forever.
    expect((await getAccountsView(TRIO)).duplicates.length).toBeGreaterThan(0);
    await prisma.nudgeDismissal.create({
      data: { userId: TRIO, dismissKey: duplicatePairDismissKey(trioPred, trioLiveC) },
    });
    const view = await getAccountsView(TRIO);
    expect(view.reconciliationAmbiguities).toHaveLength(0);
    expect(view.reconciliationCandidates).toHaveLength(1);
    expect(view.reconciliationCandidates[0].predecessor.id).toBe(trioPred);
    expect(view.reconciliationCandidates[0].successor.id).toBe(trioLiveB);
  });

  it('with pred→B active: no A→C candidate (one tap must not silently re-target a confirmed link)', async () => {
    await prisma.accountReconciliation.create({
      data: { userId: TRIO, predecessorAccountId: trioPred, successorAccountId: trioLiveB, cutoverDate: '2026-06-30', matchSignal: 'mask', confidence: 'high' },
    });
    const view = await getAccountsView(TRIO);
    expect(view.reconciliationCandidates).toHaveLength(0);
    // The folded predecessor's pairs never warn; the two LIVE twins (C-10) still do.
    expect(view.duplicates).toHaveLength(1);
    expect(new Set([view.duplicates[0].a.id, view.duplicates[0].b.id])).toEqual(new Set([trioLiveB, trioLiveC]));
  });
});

describe('L.9 critic P1-1 — a folded row that came back LIVE is never named a successor', () => {
  it('the live-again predecessor stays out of every candidate and ambiguity group; X continues into the terminal successor', async () => {
    // Executed by the fresh-context critic before the fix: P (folded into S, then reconnected, so
    // live again yet zeroed + hidden) appeared in an ambiguity group as "one of your live
    // accounts" — a row not on screen — and following the card's own how-to released a candidate
    // whose confirm silently auto-undid the user's earlier P→S combine while net worth went UP.
    await prisma.accountReconciliation.create({
      data: { userId: FOLD, predecessorAccountId: foldP, successorAccountId: foldS, cutoverDate: '2026-06-30', matchSignal: 'mask', confidence: 'high' },
    });
    const view = await getAccountsView(FOLD);

    // The earlier combine stands, disclosed; P is zeroed by the boundary.
    expect(view.reconciliations).toHaveLength(1);
    const foldPRow = [...view.assets.accounts, ...view.liabilities.accounts].find((a) => a.id === foldP);
    expect(foldPRow?.currentBalanceCents ?? 0).toBe(0);

    // No ambiguity group names P, and no candidate targets it. X's only offer is the TERMINAL
    // successor S — chain-consistent with #297.
    expect(view.reconciliationAmbiguities).toHaveLength(0);
    expect(view.reconciliationCandidates).toHaveLength(1);
    expect(view.reconciliationCandidates[0].predecessor.id).toBe(foldX);
    expect(view.reconciliationCandidates[0].successor.id).toBe(foldS);

    // Nothing about P re-warns either (it is folded, resolved), and net worth counts P zero.
    expect(view.duplicates).toHaveLength(0);
    expect(view.netWorthCents).toBe(250_000 + 230_000); // S + the still-unlinked manual X
  });
});

describe('C-10 — same-provider, different-PlaidItem twins are duplicate-eligible', () => {
  const base = { name: 'BofA Checking', type: 'CHECKING', mask: '5678', currentBalanceCents: 100_000, currency: 'USD' };
  it('flags two plaid rows from different items; same item and simplefin-simplefin stay skipped', () => {
    expect(
      detectDuplicateAccounts([
        { id: 'x', provider: 'plaid', plaidItemId: 'item-1', ...base },
        { id: 'y', provider: 'plaid', plaidItemId: 'item-2', ...base },
      ]),
    ).toHaveLength(1);
    expect(
      detectDuplicateAccounts([
        { id: 'x', provider: 'plaid', plaidItemId: 'item-1', ...base },
        { id: 'y', provider: 'plaid', plaidItemId: 'item-1', ...base },
      ]),
    ).toHaveLength(0);
    expect(
      detectDuplicateAccounts([
        { id: 'x', provider: 'simplefin', ...base },
        { id: 'y', provider: 'simplefin', ...base },
      ]),
    ).toHaveLength(0);
    // Omitting plaidItemId (an un-migrated caller) keeps the old blanket skip — never a surprise pair.
    expect(
      detectDuplicateAccounts([
        { id: 'x', provider: 'plaid', ...base },
        { id: 'y', provider: 'plaid', ...base },
      ]),
    ).toHaveLength(0);
  });
});

describe('A-F7/C-12 — /accounts payment remap + candidate span', () => {
  it('returns the boundary-remapped paymentAccountId, not the raw stored predecessor id', async () => {
    await prisma.user.update({ where: { id: OWNER }, data: { paymentAccountId: ownerPred } });
    await link();
    const view = await getAccountsView(OWNER);
    expect(view.paymentAccountId).toBe(ownerSucc); // pre-fix: ownerPred (the zeroed $0.00 row)
    await prisma.user.update({ where: { id: OWNER }, data: { paymentAccountId: null } });
  });

  it('candidates carry the predecessor’s full-history span for the cutover default/min + honest copy', async () => {
    const view = await getAccountsView(OWNER);
    expect(view.reconciliationCandidates).toHaveLength(1);
    expect(view.reconciliationCandidates[0].predecessorTxnSpan).toEqual({ first: '2026-05-01', last: '2026-06-10' });
  });
});

describe('C-5 — assistant account-balance folds superseded predecessors (pure)', () => {
  const ACCOUNTS = [
    { id: 'p', name: 'Chase Checking legacy', type: 'CHECKING', currentBalanceCents: 0, feedDroppedAt: null }, // boundary-zeroed pred
    { id: 's', name: 'Chase Checking', type: 'CHECKING', currentBalanceCents: 250_000, feedDroppedAt: null },
    { id: 'o', name: 'Ally Savings', type: 'SAVINGS', currentBalanceCents: 100_000, feedDroppedAt: null },
  ];
  const FOLD = new Map([['p', 's']]);

  it('a query naming the predecessor answers the SUCCESSOR’s live figure, disclosed', () => {
    const a = answerAccountBalance(ACCOUNTS, 'how much is in my legacy account', FOLD);
    expect(a.headline).toBe('Chase Checking has $2,500.00.');
    expect(a.detail).toMatch(/combined into its connected account/);
  });

  it('a type query counts one real account once — never the $0.00 ghost beside its successor', () => {
    const a = answerAccountBalance(ACCOUNTS, 'how much is in my checking', FOLD);
    expect(a.headline).toBe('Chase Checking has $2,500.00.');
    expect(a.facts).toEqual([{ label: 'Chase Checking', value: '$2,500.00' }]);
  });

  it('no fold map → byte-identical to the old behavior (R8 for the answer layer)', () => {
    const a = answerAccountBalance(ACCOUNTS, 'how much is in my checking');
    expect(a.headline).toBe('$2,500.00 across 2 accounts.');
  });

  it('terminalSuccessorMap follows chains to the live end and ignores ineffective links', () => {
    const accts = [
      { id: 'a', type: 'CHECKING', currentBalanceCents: 0 },
      { id: 'b', type: 'CHECKING', currentBalanceCents: 0 },
      { id: 'c', type: 'CHECKING', currentBalanceCents: 1 },
    ];
    const m = terminalSuccessorMap(accts, [
      { predecessorAccountId: 'a', successorAccountId: 'b', cutoverDate: '2026-03-31' },
      { predecessorAccountId: 'b', successorAccountId: 'c', cutoverDate: '2026-06-30' },
      { predecessorAccountId: 'gone', successorAccountId: 'c', cutoverDate: '2026-06-30' }, // inert
    ]);
    expect(m.get('a')).toBe('c');
    expect(m.get('b')).toBe('c');
    expect(m.has('gone')).toBe(false);
  });
});
