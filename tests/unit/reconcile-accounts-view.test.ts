/**
 * Wave 4.6 slice 5 — the /accounts money surface (`getAccountsView`) under reconciliation.
 *
 * This is the LAST Prisma-direct per-account balance surface (the dashboard + assistant already
 * read the boundary-adjusted snapshot). These real-Prisma tests lock the F5 fix + the display
 * plumbing the UI reads:
 *   - R2  a reconciled predecessor contributes 0 to net worth here, exactly as on the dashboard.
 *   - R6  the #192 duplicate warning is suppressed for a reconciled pair; undo brings it back.
 *   - R3  a candidate is offered only when exactly one side is live; both-live still warns.
 *   - R9  the whole thing is reversible — undo restores both balances + the candidate + the warning.
 *
 * Isolation mirrors reconciliation-server.test.ts: collision-proof throwaway user ids, wipe in
 * before/afterAll, and the reconciliation table reset per-test (afterEach).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getAccountsView } from '@/server/transactions';

const STAMP = `${Date.now()}-${process.pid}`;
const OWNER = `av-owner-${STAMP}`;
const BOTHLIVE = `av-bothlive-${STAMP}`;
const ALL_USERS = [OWNER, BOTHLIVE];

// OWNER: a disconnected SimpleFIN account (stale predecessor) + a live Plaid twin (successor),
// same mask ····1234 → a high-confidence, one-live-side candidate.
let ownerPred = ''; // simplefin, no connection → stale
let ownerSucc = ''; // plaid, PlaidItem present → live
// BOTHLIVE: the same shape but the SimpleFIN side is ALSO connected → a genuine active duplicate.
let blSimplefin = '';
let blPlaid = '';

const PRED_BALANCE = 240_000;
const SUCC_BALANCE = 250_000;

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.createMany({ data: ALL_USERS.map((id) => ({ id, email: `${id}@test.local` })) });

  // OWNER pair.
  const pred = await prisma.account.create({
    data: { userId: OWNER, provider: 'simplefin', providerRef: 'sf-own', name: 'Chase Checking (old)', type: 'CHECKING', mask: '1234', currency: 'USD', currentBalanceCents: PRED_BALANCE },
  });
  ownerPred = pred.id;
  await prisma.plaidItem.create({ data: { userId: OWNER, itemId: `av-item-${STAMP}`, accessToken: 'ct-av' } });
  const succ = await prisma.account.create({
    data: { userId: OWNER, provider: 'plaid', providerRef: 'pl-own', plaidItemId: `av-item-${STAMP}`, name: 'Chase Checking', type: 'CHECKING', mask: '1234', currency: 'USD', currentBalanceCents: SUCC_BALANCE },
  });
  ownerSucc = succ.id;

  // BOTHLIVE pair — both providers connected.
  await prisma.simpleFinConnection.create({ data: { userId: BOTHLIVE, accessUrl: 'ct-bl' } });
  const blSf = await prisma.account.create({
    data: { userId: BOTHLIVE, provider: 'simplefin', providerRef: 'sf-bl', name: 'Amex', type: 'CHECKING', mask: '9999', currency: 'USD', currentBalanceCents: 100_000 },
  });
  blSimplefin = blSf.id;
  await prisma.plaidItem.create({ data: { userId: BOTHLIVE, itemId: `av-bl-item-${STAMP}`, accessToken: 'ct-bl2' } });
  const blPl = await prisma.account.create({
    data: { userId: BOTHLIVE, provider: 'plaid', providerRef: 'pl-bl', plaidItemId: `av-bl-item-${STAMP}`, name: 'Amex', type: 'CHECKING', mask: '9999', currency: 'USD', currentBalanceCents: 100_000 },
  });
  blPlaid = blPl.id;
});

afterEach(async () => {
  await prisma.accountReconciliation.deleteMany({ where: { userId: { in: ALL_USERS } } });
});

afterAll(wipe);

const balanceOf = (view: Awaited<ReturnType<typeof getAccountsView>>, id: string): number | undefined =>
  [...view.assets.accounts, ...view.liabilities.accounts].find((a) => a.id === id)?.currentBalanceCents;

async function link(cutoverDate = '2026-07-01', undone = false) {
  await prisma.accountReconciliation.create({
    data: {
      userId: OWNER,
      predecessorAccountId: ownerPred,
      successorAccountId: ownerSucc,
      cutoverDate,
      matchSignal: 'mask',
      confidence: 'high',
      ...(undone ? { undoneAt: new Date() } : {}),
    },
  });
}

describe('getAccountsView — no reconciliation (both count)', () => {
  it('offers a candidate (predecessor=stale simplefin, successor=live plaid), counts both, suppresses the passive warning', async () => {
    const view = await getAccountsView(OWNER);

    // R3: exactly one live side → a candidate, correctly directed.
    expect(view.reconciliationCandidates).toHaveLength(1);
    expect(view.reconciliationCandidates[0].predecessor.id).toBe(ownerPred);
    expect(view.reconciliationCandidates[0].successor.id).toBe(ownerSucc);

    // Both balances count → doubled net worth (the bug this slice removes once linked).
    expect(balanceOf(view, ownerPred)).toBe(PRED_BALANCE);
    expect(balanceOf(view, ownerSucc)).toBe(SUCC_BALANCE);
    expect(view.netWorthCents).toBe(PRED_BALANCE + SUCC_BALANCE);

    // No active link yet.
    expect(view.reconciliations).toHaveLength(0);
    // The passive duplicate warning is suppressed in favor of the actionable candidate (one message).
    expect(view.duplicates).toHaveLength(0);
  });
});

describe('getAccountsView — active reconciliation', () => {
  it('zeroes the predecessor (R2), counts net worth once, discloses the pair, and suppresses candidate + warning (R6)', async () => {
    await link();
    const view = await getAccountsView(OWNER);

    // R2: predecessor contributes 0; successor keeps its live balance.
    expect(balanceOf(view, ownerPred)).toBe(0);
    expect(balanceOf(view, ownerSucc)).toBe(SUCC_BALANCE);
    expect(view.netWorthCents).toBe(SUCC_BALANCE);

    // The pair is disclosed as one logical account (for the "combined accounts" card + Undo).
    expect(view.reconciliations).toHaveLength(1);
    expect(view.reconciliations[0].predecessor.id).toBe(ownerPred);
    expect(view.reconciliations[0].successor.id).toBe(ownerSucc);
    expect(view.reconciliations[0].id).toBeTruthy();

    // R6 + no re-proposal: neither a warning nor a candidate for an already-resolved pair.
    expect(view.duplicates).toHaveLength(0);
    expect(view.reconciliationCandidates).toHaveLength(0);
  });
});

describe('getAccountsView — undone reconciliation (R9 reversible)', () => {
  it('restores both balances, the candidate, and the warning-as-candidate exactly as pre-link', async () => {
    await link('2026-07-01', true); // undoneAt set → inert
    const view = await getAccountsView(OWNER);

    expect(balanceOf(view, ownerPred)).toBe(PRED_BALANCE);
    expect(balanceOf(view, ownerSucc)).toBe(SUCC_BALANCE);
    expect(view.netWorthCents).toBe(PRED_BALANCE + SUCC_BALANCE);
    expect(view.reconciliations).toHaveLength(0);
    expect(view.reconciliationCandidates).toHaveLength(1);
  });
});

describe('getAccountsView — both providers live (R3 guard, no over-suppression)', () => {
  it('offers NO candidate and still shows the passive duplicate warning', async () => {
    const view = await getAccountsView(BOTHLIVE);
    expect(view.reconciliationCandidates).toHaveLength(0);
    // Both live → the #192 warning is the right message; it must NOT be suppressed.
    expect(view.duplicates).toHaveLength(1);
    const pair = view.duplicates[0];
    expect([pair.a.id, pair.b.id].sort()).toEqual([blSimplefin, blPlaid].sort());
  });
});
