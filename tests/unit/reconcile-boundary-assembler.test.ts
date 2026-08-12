/**
 * Reconciliation boundary THROUGH the real assembler (TASKS Wave 4.6 slice 3).
 * Real-Prisma tests (shared temp SQLite, throwaway users) proving the boundary is
 * actually wired into `getFinanceSnapshot` — the pure-engine tests prove the math,
 * these prove the plumbing and the write-time contracts added this slice:
 *
 *   R1/R2 — a confirmed link changes the LIVE snapshot: predecessor balance reads 0,
 *           the date split holds at the exact cutover, paymentAccountId remaps.
 *   R9/R8 — undo restores a snapshot deep-equal to the never-linked baseline
 *           (the full round-trip through confirm → undo at the assembler surface).
 *   Cross-type refusal — a CHECKING→CREDIT link is refused at confirm (the engine
 *           would treat it as inert; the action tells the user honestly instead).
 *   Reverse-link auto-undo — confirming P→S undoes an active link claiming S is
 *           itself a stale predecessor (X where predecessor==S), because this
 *           confirm just re-proved S live; chains (Q→P) are NOT undone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { DemoProvider } from '@/lib/providers/demo';
import { confirmReconciliationFor, getActiveReconciliations, undoReconciliationFor } from '@/server/reconciliation';
import { resolvePaymentAccount } from '@/server/finance';
import { getCashFlowForecast } from '@/server/forecast';
import type { FinanceSnapshot } from '@/lib/providers/types';

const TODAY = isoDate('2026-07-22');
const CUTOVER = '2026-06-30';
const STAMP = `${Date.now()}-${process.pid}-asm`;
const USER = `recon-asm-${STAMP}`;
const CHAINUSER = `recon-asm-chain-${STAMP}`;
const QCHAIN = `recon-asm-qchain-${STAMP}`;
const ALL_USERS = [USER, CHAINUSER, QCHAIN];

let predId = '';
let succId = '';
let bystanderId = '';

const provider = new DemoProvider();

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.createMany({ data: ALL_USERS.map((id) => ({ id, email: `${id}@test.local` })) });

  // Live Plaid successor.
  await prisma.plaidItem.create({ data: { userId: USER, itemId: `it-${STAMP}`, accessToken: 'ct' } });
  const succ = await prisma.account.create({
    data: {
      userId: USER, provider: 'plaid', providerRef: 'pl-1', plaidItemId: `it-${STAMP}`,
      name: 'Chase Checking', type: 'CHECKING', currentBalanceCents: 250_000, availableBalanceCents: 251_000,
    },
  });
  succId = succ.id;
  // Stale SimpleFIN predecessor (no SimpleFinConnection row → not live).
  const pred = await prisma.account.create({
    data: {
      userId: USER, provider: 'simplefin', providerRef: 'sf-1',
      name: 'Chase Checking (old)', type: 'CHECKING', currentBalanceCents: 240_000, availableBalanceCents: 239_000,
    },
  });
  predId = pred.id;
  const by = await prisma.account.create({
    data: { userId: USER, provider: 'manual', name: 'Savings', type: 'SAVINGS', currentBalanceCents: 100_000 },
  });
  bystanderId = by.id;
  // The user designated the OLD row as their payment account — the remap case.
  await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: predId } });

  const txn = (accountId: string, date: string, amountCents: number, d: string) => ({
    accountId, date, amountCents, rawDescriptor: d, categoryId: null, status: 'POSTED',
  });
  await prisma.transaction.createMany({
    data: [
      txn(predId, '2026-06-29', -1_000, 'PRED BEFORE'),
      txn(predId, CUTOVER, -2_000, 'PRED ON'),
      txn(predId, '2026-07-01', -3_000, 'PRED AFTER'), // must vanish once linked
      txn(succId, CUTOVER, -4_000, 'SUCC ON'), // must vanish once linked
      txn(succId, '2026-07-01', -5_000, 'SUCC AFTER'),
    ],
  });
  await prisma.balanceSnapshot.createMany({
    data: [
      { accountId: predId, date: CUTOVER, balanceCents: 240_000 },
      { accountId: predId, date: '2026-07-31', balanceCents: 240_000 }, // must vanish once linked
      { accountId: succId, date: CUTOVER, balanceCents: 249_000 }, // must vanish once linked
      { accountId: succId, date: '2026-07-31', balanceCents: 252_000 },
    ],
  });
});

afterAll(wipe);

const confirm = () =>
  confirmReconciliationFor(
    USER,
    {
      predecessorAccountId: predId,
      successorAccountId: succId,
      cutoverDate: CUTOVER,
      matchSignal: 'mask',
      confidence: 'high',
    },
    TODAY,
  );

/** Normalize for deep-equality across calls (rows come back in stable orderBy already). */
const strip = (s: FinanceSnapshot) => JSON.parse(JSON.stringify(s)) as FinanceSnapshot;

describe('getFinanceSnapshot with an active reconciliation', () => {
  let baseline: FinanceSnapshot;

  it('baseline (no link): both rows count fully — the pre-fix double-count is visible', async () => {
    baseline = await provider.getFinanceSnapshot(USER);
    const total = baseline.accounts.reduce((s, a) => s + a.currentBalanceCents, 0);
    expect(total).toBe(590_000); // 240k stale + 250k live + 100k savings
    expect(baseline.transactions).toHaveLength(5);
    expect(baseline.balanceSnapshots).toHaveLength(4);
    expect(baseline.paymentAccountId).toBe(predId);
  });

  it('R2 live: after confirm, the predecessor contributes 0 and the funding account remaps', async () => {
    const res = await confirm();
    expect(res).toMatchObject({ ok: true });

    const snap = await provider.getFinanceSnapshot(USER);
    const pred = snap.accounts.find((a) => a.id === predId)!;
    expect(pred.currentBalanceCents).toBe(0);
    expect((pred as { availableBalanceCents?: number | null }).availableBalanceCents).toBe(0);
    expect(snap.accounts.reduce((s, a) => s + a.currentBalanceCents, 0)).toBe(350_000);
    expect(snap.paymentAccountId).toBe(succId);
    // The row itself stays — identity preserved for joins and history (never removed).
    expect(snap.accounts.map((a) => a.id)).toContain(predId);
  });

  it('R1 live: the date split holds at the exact cutover through the real assembler', async () => {
    const snap = await provider.getFinanceSnapshot(USER);
    const key = (t: { accountId: string; date: string }) =>
      `${t.accountId === predId ? 'pred' : t.accountId === succId ? 'succ' : 'other'}:${t.date}`;
    // U.13: the cutover day is the handover and is released to BOTH sides through the
    // real assembler too — the engine change reaches every surface by construction,
    // which is the property this assembler test exists to prove.
    expect(snap.transactions.map(key).sort()).toEqual([
      'pred:2026-06-29',
      `pred:${CUTOVER}`,
      `succ:${CUTOVER}`,
      'succ:2026-07-01',
    ]);
    expect(snap.balanceSnapshots.map(key).sort()).toEqual([`pred:${CUTOVER}`, 'succ:2026-07-31']);
  });

  it('R9 + R8: undo restores a snapshot deep-equal to the never-linked baseline', async () => {
    const [link] = await getActiveReconciliations(USER);
    expect(link).toBeDefined();
    const undo = await undoReconciliationFor(USER, link.id);
    expect(undo).toEqual({ ok: true });

    const snap = await provider.getFinanceSnapshot(USER);
    expect(strip(snap)).toEqual(strip(baseline));
  });

  it('re-confirm after undo re-applies the boundary (the full R9 round-trip)', async () => {
    const res = await confirm();
    expect(res).toMatchObject({ ok: true });
    const snap = await provider.getFinanceSnapshot(USER);
    expect(snap.accounts.reduce((s, a) => s + a.currentBalanceCents, 0)).toBe(350_000);
  });
});

describe('F1: fallback funding-account resolution skips the zeroed predecessor', () => {
  // The confirmed cycle-1 P0: no stored payment account, the one real checking
  // migrated SimpleFIN→Plaid and is linked. The OLD row sorts first (id asc /
  // creation order), so every fallback used to anchor cash-needed/forecast on a
  // $0 balance — an 80 000¢ fabricated shortfall in the executed repro.
  it('resolvePaymentAccount picks the successor when no payment account is designated', async () => {
    await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: null } });
    try {
      const snap = await provider.getFinanceSnapshot(USER);
      expect(snap.supersededAccountIds).toEqual([predId]);
      const picked = resolvePaymentAccount(snap);
      expect(picked.id).toBe(succId);
      expect(picked.currentBalanceCents).toBe(250_000);
    } finally {
      await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: predId } });
    }
  });

  it('the forecast anchors on the successor’s live balance, never the zeroed predecessor', async () => {
    await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: null } });
    try {
      const data = await getCashFlowForecast(USER);
      expect(data.accountName).toBe('Chase Checking'); // the live Plaid row, not "(old)"
      expect(data.forecast.startingBalanceCents).toBe(250_000);
    } finally {
      await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: predId } });
    }
  });
});

describe('confirm-time contracts added in slice 3', () => {
  it('refuses a cross-type link with an honest error', async () => {
    const res = await confirmReconciliationFor(
      USER,
      {
        predecessorAccountId: bystanderId, // SAVINGS
        successorAccountId: succId, // CHECKING (live)
        cutoverDate: CUTOVER,
        matchSignal: 'name',
        confidence: 'medium',
      },
      TODAY,
    );
    expect(res).toEqual({ ok: false, error: 'Those accounts aren’t the same kind, so they can’t be the same account.' });
  });

  it('auto-undoes a reverse link whose predecessor is the successor just re-proven live', async () => {
    // Chain user: old1 (stale sf) … plaid P was linked as predecessor of old1?? No —
    // build the actual conflict: first X→S is confirmed while S was stale-shaped, then
    // the user migrates back and confirms P→S with S live. Simplest honest setup:
    // create the reverse row DIRECTLY (it is a historical artifact), then confirm.
    await prisma.plaidItem.create({ data: { userId: CHAINUSER, itemId: `it-ch-${STAMP}`, accessToken: 'ct' } });
    const live = await prisma.account.create({
      data: {
        userId: CHAINUSER, provider: 'plaid', providerRef: 'pl-ch', plaidItemId: `it-ch-${STAMP}`,
        name: 'Live', type: 'CHECKING', currentBalanceCents: 10_000,
      },
    });
    const stale = await prisma.account.create({
      data: { userId: CHAINUSER, provider: 'simplefin', providerRef: 'sf-ch', name: 'Stale', type: 'CHECKING', currentBalanceCents: 9_000 },
    });
    // Historical artifact: a link claiming the (now-live) account is a stale predecessor.
    await prisma.accountReconciliation.create({
      data: {
        userId: CHAINUSER,
        predecessorAccountId: live.id,
        successorAccountId: stale.id,
        cutoverDate: '2026-05-31',
        matchSignal: 'mask',
        confidence: 'high',
        confirmedByUserAt: new Date('2026-06-01T00:00:00Z'),
      },
    });

    const res = await confirmReconciliationFor(
      CHAINUSER,
      {
        predecessorAccountId: stale.id,
        successorAccountId: live.id,
        cutoverDate: '2026-06-30',
        matchSignal: 'mask',
        confidence: 'high',
      },
      TODAY,
    );
    expect(res).toMatchObject({ ok: true });

    const active = await getActiveReconciliations(CHAINUSER);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ predecessorAccountId: stale.id, successorAccountId: live.id });
    // The reverse row still exists — undone, not deleted (reversible, auditable).
    const reverse = await prisma.accountReconciliation.findUnique({ where: { predecessorAccountId: live.id } });
    expect(reverse?.undoneAt).not.toBeNull();
  });

  it('does NOT undo a legitimate chain link Q→P when confirming P→S', async () => {
    await prisma.plaidItem.create({ data: { userId: QCHAIN, itemId: `it-q-${STAMP}`, accessToken: 'ct' } });
    const s = await prisma.account.create({
      data: {
        userId: QCHAIN, provider: 'plaid', providerRef: 'pl-q', plaidItemId: `it-q-${STAMP}`,
        name: 'Gen3 live', type: 'CHECKING', currentBalanceCents: 30_000,
      },
    });
    const p = await prisma.account.create({
      data: { userId: QCHAIN, provider: 'simplefin', providerRef: 'sf-q', name: 'Gen2', type: 'CHECKING', currentBalanceCents: 20_000 },
    });
    const q = await prisma.account.create({
      data: { userId: QCHAIN, provider: 'manual', name: 'Gen1', type: 'CHECKING', currentBalanceCents: 10_000 },
    });
    // Existing generation-1 supersession: Q→P (P was the live side back then).
    await prisma.accountReconciliation.create({
      data: {
        userId: QCHAIN, predecessorAccountId: q.id, successorAccountId: p.id,
        cutoverDate: '2026-03-31', matchSignal: 'name', confidence: 'medium',
      },
    });

    const res = await confirmReconciliationFor(
      QCHAIN,
      { predecessorAccountId: p.id, successorAccountId: s.id, cutoverDate: '2026-06-30', matchSignal: 'mask', confidence: 'high' },
      TODAY,
    );
    expect(res).toMatchObject({ ok: true });

    // Both links active: the chain Q→P→S is legitimate; only a REVERSE link
    // (predecessor === the successor just proven live) would have been undone.
    const active = await getActiveReconciliations(QCHAIN);
    expect(active).toHaveLength(2);
    expect(active.map((l) => `${l.predecessorAccountId}->${l.successorAccountId}`).sort()).toEqual(
      [`${p.id}->${s.id}`, `${q.id}->${p.id}`].sort(),
    );

    // F9 (cycle-2 critic): chain cutover monotonicity. Re-confirming the downstream
    // link P→S with a cutover EARLIER than upstream Q→P's (2026-03-31) would open a
    // window both Q and S keep — refused. On/after the upstream cutover stays fine.
    const misordered = await confirmReconciliationFor(
      QCHAIN,
      { predecessorAccountId: p.id, successorAccountId: s.id, cutoverDate: '2026-02-28', matchSignal: 'mask', confidence: 'high' },
      TODAY,
    );
    expect(misordered).toEqual({
      ok: false,
      error: 'The cutover date can’t be earlier than this account’s previous reconciliation.',
    });
    const boundaryOk = await confirmReconciliationFor(
      QCHAIN,
      { predecessorAccountId: p.id, successorAccountId: s.id, cutoverDate: '2026-03-31', matchSignal: 'mask', confidence: 'high' },
      TODAY,
    );
    expect(boundaryOk).toMatchObject({ ok: true });
  });
});
