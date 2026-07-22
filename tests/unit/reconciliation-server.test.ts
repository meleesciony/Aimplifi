/**
 * Cross-provider account reconciliation — confirm/undo server contract (TASKS Wave 4.6 slice 2).
 * Real-Prisma tests (shared temp SQLite, throwaway users) locking the ACTION invariants:
 *   R10 — authz: a user can only reconcile their OWN accounts; ids re-resolved + ownership
 *         re-checked inside the mutation; a wrong/foreign id is an indistinguishable "not found".
 *   R9  — reversible: confirm → undo → re-confirm round-trips via the predecessor @unique slot.
 *   R7  — inert-on-delete precondition: no Account FK, so deleting an underlying account leaves
 *         the link row intact (the assembler ignoring it is proven in slice 3).
 *   R3  — direction guard at the confirm boundary: successor must be live, predecessor stale;
 *         both-live and successor-not-live are refused.
 * Plus cutover bounds (future / before-first-txn) and scalar/enum validation + the demo fence.
 *
 * The aggregation invariants R1/R2/R8 (balance exclusion + date split) belong to the assembler
 * (slice 3) and are NOT asserted here — this slice mutates only the link table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { DEMO_RECONCILE_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import {
  confirmReconciliationFor,
  getActiveReconciliations,
  isAccountLive,
  undoReconciliationFor,
} from '@/server/reconciliation';

const TODAY = isoDate('2026-07-22');
const STAMP = `${Date.now()}-${process.pid}`;

// Collision-proof throwaway users; wipe cascades accounts/txns/connections/links.
const OWNER = `recon-owner-${STAMP}`;
const STRANGER = `recon-stranger-${STAMP}`;
const BOTHLIVE = `recon-bothlive-${STAMP}`;
const MANUAL = `recon-manual-${STAMP}`;
const ALL_USERS = [OWNER, STRANGER, BOTHLIVE, MANUAL];

// Resolved ids captured at seed time.
let ownerSucc = ''; // live Plaid account (successor)
let ownerPred = ''; // stale SimpleFIN account (predecessor), first txn 2026-03-01
let strangerAcct = '';
let blPlaid = ''; // live
let blSf = ''; // live (BOTHLIVE has a SimpleFinConnection)
let manSucc = ''; // live Plaid
let manPred = ''; // manual, never live

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } });
}

async function makePlaid(userId: string, itemId: string, name: string, balanceCents: number): Promise<string> {
  await prisma.plaidItem.create({ data: { userId, itemId, accessToken: `ct-${itemId}` } });
  const a = await prisma.account.create({
    data: { userId, provider: 'plaid', providerRef: `${itemId}-acct`, plaidItemId: itemId, name, type: 'CHECKING', currentBalanceCents: balanceCents },
  });
  return a.id;
}

beforeAll(async () => {
  await wipe();
  await prisma.user.createMany({ data: ALL_USERS.map((id) => ({ id, email: `${id}@test.local` })) });

  // OWNER: live Plaid successor + stale SimpleFIN predecessor (NO SimpleFinConnection → not live).
  ownerSucc = await makePlaid(OWNER, `it-own-${STAMP}`, 'Chase Checking', 250_000);
  const pred = await prisma.account.create({
    data: { userId: OWNER, provider: 'simplefin', providerRef: 'sf-own', name: 'Chase (old)', type: 'CHECKING', currentBalanceCents: 240_000 },
  });
  ownerPred = pred.id;
  await prisma.transaction.create({ data: { accountId: ownerPred, date: '2026-03-01', amountCents: -1_200, rawDescriptor: 'GROCERY', categoryId: null, status: 'POSTED' } });

  // STRANGER: one account, for the cross-user authz probe.
  const sa = await prisma.account.create({
    data: { userId: STRANGER, provider: 'plaid', providerRef: 'sa', name: 'Stranger Checking', type: 'CHECKING', currentBalanceCents: 100_000 },
  });
  strangerAcct = sa.id;

  // BOTHLIVE: a live Plaid account AND a live SimpleFIN account (connection present) → both live.
  blPlaid = await makePlaid(BOTHLIVE, `it-bl-${STAMP}`, 'BL Plaid', 500_000);
  await prisma.simpleFinConnection.create({ data: { userId: BOTHLIVE, accessUrl: 'ct-bl' } });
  const bs = await prisma.account.create({
    data: { userId: BOTHLIVE, provider: 'simplefin', providerRef: 'bl-sf', name: 'BL SimpleFIN', type: 'CHECKING', currentBalanceCents: 500_000 },
  });
  blSf = bs.id;

  // MANUAL: live Plaid successor + a MANUAL predecessor (never live → predecessor-eligible).
  manSucc = await makePlaid(MANUAL, `it-man-${STAMP}`, 'Man Plaid', 80_000);
  const mp = await prisma.account.create({
    data: { userId: MANUAL, provider: 'manual', providerRef: null, name: 'Cash (manual)', type: 'CHECKING', currentBalanceCents: 5_000 },
  });
  manPred = mp.id;
});

afterAll(wipe);

const validInput = () => ({
  predecessorAccountId: ownerPred,
  successorAccountId: ownerSucc,
  cutoverDate: '2026-06-01',
  matchSignal: 'mask',
  confidence: 'high',
});

describe('isAccountLive (shared liveness derivation)', () => {
  const conns = { simplefinConnected: true, plaidItemIds: new Set(['it-x']) };
  it('plaid is live iff its stamped item still exists', () => {
    expect(isAccountLive({ provider: 'plaid', plaidItemId: 'it-x' }, conns)).toBe(true);
    expect(isAccountLive({ provider: 'plaid', plaidItemId: 'gone' }, conns)).toBe(false);
    expect(isAccountLive({ provider: 'plaid', plaidItemId: null }, conns)).toBe(false);
  });
  it('simplefin follows the per-user connection; manual/demo are never live', () => {
    expect(isAccountLive({ provider: 'simplefin', plaidItemId: null }, conns)).toBe(true);
    expect(isAccountLive({ provider: 'simplefin', plaidItemId: null }, { simplefinConnected: false, plaidItemIds: new Set() })).toBe(false);
    expect(isAccountLive({ provider: 'manual', plaidItemId: null }, conns)).toBe(false);
    expect(isAccountLive({ provider: 'demo', plaidItemId: null }, conns)).toBe(false);
  });
});

describe('confirmReconciliation — validation + demo fence', () => {
  it('fences the shared demo account (defense in depth)', async () => {
    const res = await confirmReconciliationFor(DEMO_USER_ID, validInput(), TODAY);
    expect(res).toEqual({ ok: false, error: DEMO_RECONCILE_BLOCKED });
  });

  it('refuses non-scalar ids as a generic not-found', async () => {
    // Attacker-shaped input: a filter object where a string id is expected.
    const res = await confirmReconciliationFor(OWNER, { ...validInput(), predecessorAccountId: { not: '' } as unknown as string }, TODAY);
    expect(res).toEqual({ ok: false, error: 'Account not found.' });
  });

  it('refuses linking an account with itself', async () => {
    const res = await confirmReconciliationFor(OWNER, { ...validInput(), successorAccountId: ownerPred }, TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/itself/);
  });

  it('refuses an unrecognized matchSignal or confidence', async () => {
    expect((await confirmReconciliationFor(OWNER, { ...validInput(), matchSignal: 'vibes' }, TODAY)).ok).toBe(false);
    expect((await confirmReconciliationFor(OWNER, { ...validInput(), confidence: 'certain' }, TODAY)).ok).toBe(false);
  });

  it('refuses a malformed cutover date', async () => {
    const res = await confirmReconciliationFor(OWNER, { ...validInput(), cutoverDate: '2026-13-40' }, TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/valid calendar date/);
  });

  it('refuses a future cutover date', async () => {
    const res = await confirmReconciliationFor(OWNER, { ...validInput(), cutoverDate: '2026-08-01' }, TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/future/);
  });

  it('refuses a cutover before the predecessor’s first transaction', async () => {
    const res = await confirmReconciliationFor(OWNER, { ...validInput(), cutoverDate: '2026-02-01' }, TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/first transaction/);
  });
});

describe('confirmReconciliation — authz (R10)', () => {
  it('cannot name another user’s account as successor', async () => {
    const res = await confirmReconciliationFor(OWNER, { ...validInput(), successorAccountId: strangerAcct }, TODAY);
    expect(res).toEqual({ ok: false, error: 'Account not found.' });
    expect(await prisma.accountReconciliation.count({ where: { predecessorAccountId: ownerPred } })).toBe(0);
  });

  it('cannot name another user’s account as predecessor', async () => {
    const res = await confirmReconciliationFor(OWNER, { ...validInput(), predecessorAccountId: strangerAcct }, TODAY);
    expect(res).toEqual({ ok: false, error: 'Account not found.' });
  });
});

describe('confirmReconciliation — direction guard (R3)', () => {
  it('refuses when the successor is not a live connection', async () => {
    // Swap direction: stale SimpleFIN as successor, live Plaid as predecessor.
    const res = await confirmReconciliationFor(OWNER, { predecessorAccountId: ownerSucc, successorAccountId: ownerPred, cutoverDate: '2026-06-01', matchSignal: 'mask', confidence: 'high' }, TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nothing live/);
  });

  it('refuses when BOTH sides are still live (genuine active duplicate)', async () => {
    const res = await confirmReconciliationFor(BOTHLIVE, { predecessorAccountId: blSf, successorAccountId: blPlaid, cutoverDate: '2026-06-01', matchSignal: 'balance', confidence: 'high' }, TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Both accounts are still connected/);
    expect(await prisma.accountReconciliation.count({ where: { predecessorAccountId: blSf } })).toBe(0);
  });

  it('accepts a MANUAL predecessor (never live → predecessor-eligible)', async () => {
    const res = await confirmReconciliationFor(MANUAL, { predecessorAccountId: manPred, successorAccountId: manSucc, cutoverDate: TODAY, matchSignal: 'name', confidence: 'medium' }, TODAY);
    expect(res.ok).toBe(true);
  });
});

describe('confirmReconciliation — happy path + reversibility (R9)', () => {
  let linkId = '';

  it('creates the link with the confirmed fields', async () => {
    const res = await confirmReconciliationFor(OWNER, validInput(), TODAY);
    expect(res.ok).toBe(true);
    if (res.ok) linkId = res.id;

    const active = await getActiveReconciliations(OWNER);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ predecessorAccountId: ownerPred, successorAccountId: ownerSucc, cutoverDate: '2026-06-01' });
  });

  it('undo makes the link inert but keeps the row (R9)', async () => {
    const res = await undoReconciliationFor(OWNER, linkId);
    expect(res).toEqual({ ok: true });
    expect(await getActiveReconciliations(OWNER)).toHaveLength(0);
    const row = await prisma.accountReconciliation.findUnique({ where: { id: linkId }, select: { undoneAt: true } });
    expect(row?.undoneAt).not.toBeNull();
  });

  it('re-undoing an already-inert link is a no-op not-found', async () => {
    expect((await undoReconciliationFor(OWNER, linkId)).ok).toBe(false);
  });

  it('re-confirm after undo re-activates the SAME row via the predecessor @unique slot', async () => {
    const res = await confirmReconciliationFor(OWNER, { ...validInput(), cutoverDate: '2026-05-15' }, TODAY);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.id).toBe(linkId); // upsert updated, not duplicated
    const active = await getActiveReconciliations(OWNER);
    expect(active).toHaveLength(1);
    expect(active[0].cutoverDate).toBe('2026-05-15');
    // Exactly one row ever existed for this predecessor (no duplicate from re-confirm).
    expect(await prisma.accountReconciliation.count({ where: { predecessorAccountId: ownerPred } })).toBe(1);
  });

  it('a stranger cannot undo the owner’s active link (R10)', async () => {
    const res = await undoReconciliationFor(STRANGER, linkId);
    expect(res.ok).toBe(false);
    expect(await getActiveReconciliations(OWNER)).toHaveLength(1); // still active
  });
});

describe('inert-on-delete precondition (R7)', () => {
  it('deleting an underlying account leaves the link row intact (no Account FK cascade)', async () => {
    // MANUAL was linked (manPred → manSucc) above. Delete the predecessor account.
    const before = await prisma.accountReconciliation.findFirst({ where: { predecessorAccountId: manPred }, select: { id: true } });
    expect(before).not.toBeNull();
    await prisma.account.delete({ where: { id: manPred } });
    const after = await prisma.accountReconciliation.findFirst({ where: { predecessorAccountId: manPred }, select: { id: true, undoneAt: true } });
    expect(after?.id).toBe(before?.id); // the link survives; slice 3's assembler ignores the dangling ref
  });
});
