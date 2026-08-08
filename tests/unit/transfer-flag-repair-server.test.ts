/**
 * H.7b — the transfer-flag repair, server half: preview / apply / undo against
 * a real database, through the same read the sweep uses.
 *
 * The corpus is the live defect's shape in miniature:
 *  - a settled income row + a settled CREDIT-card outflow, equal |amounts| two
 *    days apart — the pre-H.7 rule flagged both; today's rule DECLINES the pair
 *    (a card outflow is a purchase, not a sending leg) → the repair set;
 *  - a settled checking→brokerage pair — directionally coherent, so today's
 *    rule ENDORSES those flags → untouched forever.
 *
 * The doctrine locked here:
 *  - apply clears exactly the declined settled rows, records the run, and the
 *    NEXT SWEEP cannot re-flag what it cleared (repair and sweep share a rule);
 *  - undo restores only rows still carrying the verdict they had at clear time
 *    — a reader's newer decision wins (the H.6b(a) rule);
 *  - one undo per run, ownership enforced, demo writes fenced.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Partial mock of the sweep module: pass-through by default, overridable ONCE
// per test so the stale-read interleave (critic P1-3's demanded lock) can hand
// `applyTransferFlagRepair` a read that predates a user's re-decision.
vi.mock('@/lib/providers/transfer-refresh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providers/transfer-refresh')>();
  return { ...actual, loadTransferSweepRows: vi.fn(actual.loadTransferSweepRows) };
});

import { auth } from '@/auth';
import { loadTransferSweepRows } from '@/lib/providers/transfer-refresh';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import { refreshTransferFlags } from '@/lib/providers/transfer-refresh';
import {
  applyTransferFlagRepair,
  getTransferFlagRepairPreview,
  undoTransferFlagRepair,
} from '@/server/transfer-flag-repair';
import { applyTransferFlagRepairAction } from '@/server/transfer-flag-repair-actions';

describe('H.7b: the transfer-flag repair against a real database', () => {
  const USER = `h7r-${Date.now()}-${process.pid}`;
  let CHECKING = '';
  let CARD = '';
  let BROKERAGE = '';

  async function wipe() {
    await prisma.transferFlagRepairRun.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);

  beforeEach(async () => {
    await prisma.transferFlagRepairRun.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    const mk = async (name: string, type: string) =>
      (
        await prisma.account.create({
          data: { userId: USER, provider: 'demo', name, type, currentBalanceCents: 100_000, currency: 'USD' },
        })
      ).id;
    CHECKING = await mk('Everyday Checking', 'CHECKING');
    CARD = await mk('Rewards Card', 'CREDIT');
    BROKERAGE = await mk('Brokerage', 'INVESTMENT');
  });

  /** The pre-H.7 rule's false positives (declined today) plus one genuine,
   * still-endorsed pair. All settled, all flagged. */
  async function seedFlaggedCorpus() {
    await prisma.transaction.createMany({
      data: [
        // DECLINED pair: income on checking vs card purchase, |$500|, 2 days apart.
        {
          id: `${USER}-income`,
          accountId: CHECKING,
          date: '2026-07-03',
          amountCents: 50_000,
          rawDescriptor: '5006-DB/CR-CEF I CEF IV PPD',
          categoryId: 'income',
          confidenceBps: 9900,
          needsReview: false,
          isTransfer: true,
        },
        {
          id: `${USER}-card`,
          accountId: CARD,
          date: '2026-07-01',
          amountCents: -50_000,
          rawDescriptor: 'KALSHI INC PAYMENT',
          categoryId: 'entertainment',
          confidenceBps: 9000,
          needsReview: false,
          isTransfer: true,
        },
        // ENDORSED pair: checking sends to brokerage — coherent, flags stand.
        {
          id: `${USER}-fund-out`,
          accountId: CHECKING,
          date: '2026-07-10',
          amountCents: -200_000,
          rawDescriptor: 'WIRE OUT 20260710',
          categoryId: 'groceries',
          confidenceBps: 9000,
          needsReview: false,
          isTransfer: true,
        },
        {
          id: `${USER}-fund-in`,
          accountId: BROKERAGE,
          date: '2026-07-11',
          amountCents: 200_000,
          rawDescriptor: 'INCOMING WIRE',
          categoryId: 'income',
          confidenceBps: 9000,
          needsReview: false,
          isTransfer: true,
        },
      ],
    });
  }

  it('preview states the change before it happens: the declined pair, its dollars, and the endorsed flags it keeps', async () => {
    await seedFlaggedCorpus();
    const p = await getTransferFlagRepairPreview(USER);
    expect(p.clearCount).toBe(2);
    expect(p.inflowCents).toBe(50_000);
    expect(p.outflowCents).toBe(50_000);
    expect(p.incomeCategorisedCount).toBe(1);
    expect(p.endorsedCount).toBe(2);
    expect(p.flaggedCount).toBe(4);
    const byId = new Map(p.rows.map((r) => [r.id, r]));
    expect(byId.get(`${USER}-income`)?.accountName).toBe('Everyday Checking');
    expect(byId.get(`${USER}-income`)?.categoryName).toBe('Income');
    expect(byId.get(`${USER}-card`)?.categoryName).toBe('Entertainment & Streaming');
  });

  it('apply clears exactly the declined rows, records the run, and the next sweep cannot re-flag them', async () => {
    await seedFlaggedCorpus();
    const res = await applyTransferFlagRepair(USER);
    expect(res).toMatchObject({ ok: true, cleared: 2, skipped: 0, inflowCents: 50_000, outflowCents: 50_000 });
    expect(res.runId).not.toBeNull();

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    const flag = new Map(rows.map((r) => [r.id, r.isTransfer]));
    expect(flag.get(`${USER}-income`)).toBe(false);
    expect(flag.get(`${USER}-card`)).toBe(false);
    // The endorsed pair is untouched — a repair is a re-check, not a purge.
    expect(flag.get(`${USER}-fund-out`)).toBe(true);
    expect(flag.get(`${USER}-fund-in`)).toBe(true);
    // The cleared rows keep their own settled verdicts — nothing new was decided.
    const income = rows.find((r) => r.id === `${USER}-income`)!;
    expect(income.categoryId).toBe('income');
    expect(income.needsReview).toBe(false);

    // The run row is the undo's premise.
    const run = await prisma.transferFlagRepairRun.findUniqueOrThrow({ where: { id: res.runId! } });
    expect(run.clearedCount).toBe(2);
    expect(run.undoneAt).toBeNull();
    expect(
      (JSON.parse(run.clearedRows) as Array<{ id: string }>).map((r) => r.id).sort(),
    ).toEqual([`${USER}-card`, `${USER}-income`]);

    // Audit trail exists and names the counts.
    const audit = await prisma.auditLog.findFirst({
      where: { userId: USER, action: 'transfers.flag-repair' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit!.meta)).toMatchObject({ cleared: 2, skipped: 0 });

    // SWEEP STABILITY, through the real sweep: nothing re-flags.
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 0, overturned: 0, filed: 0 });
    const after = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(after.find((r) => r.id === `${USER}-income`)!.isTransfer).toBe(false);

    // And a second apply finds nothing: no new run is minted.
    const again = await applyTransferFlagRepair(USER);
    expect(again).toMatchObject({ ok: true, cleared: 0, runId: null });
    expect(await prisma.transferFlagRepairRun.count({ where: { userId: USER } })).toBe(1);
  });

  it('undo restores the flags — except on a row the reader re-decided since, whose own value wins', async () => {
    await seedFlaggedCorpus();
    const res = await applyTransferFlagRepair(USER);

    // The reader re-files the card row after the repair: their decision, kept.
    await prisma.transaction.update({
      where: { id: `${USER}-card` },
      data: { categoryId: 'dining' },
    });

    const undo = await undoTransferFlagRepair(USER, res.runId!);
    expect(undo).toEqual({ ok: true, restored: 1, skipped: 1 });

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(`${USER}-income`)!.isTransfer).toBe(true); // restored
    expect(byId.get(`${USER}-card`)!.isTransfer).toBe(false); // reader's re-file wins
    expect(byId.get(`${USER}-card`)!.categoryId).toBe('dining');

    // One undo per run.
    const second = await undoTransferFlagRepair(USER, res.runId!);
    expect(second.ok).toBe(false);
    expect(second.restored).toBe(0);
    const run = await prisma.transferFlagRepairRun.findUniqueOrThrow({ where: { id: res.runId! } });
    expect(run.undoneAt).not.toBeNull();
  });

  it('undo refuses a run the caller does not own', async () => {
    await seedFlaggedCorpus();
    const res = await applyTransferFlagRepair(USER);
    const undo = await undoTransferFlagRepair('someone-else', res.runId!);
    expect(undo.ok).toBe(false);
    // Nothing moved.
    const income = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-income` } });
    expect(income.isTransfer).toBe(false);
  });

  it('PREMISE LOCK (critic P1-3): a row the reader re-decides inside the read→write window is skipped, and the run records what actually happened', async () => {
    await seedFlaggedCorpus();
    // Capture the read as of now, then let the reader un-resolve the income row
    // (the undo-corrections shape) BEFORE the apply's write reaches it.
    const staleRows = await loadTransferSweepRows(USER);
    await prisma.transaction.update({
      where: { id: `${USER}-income` },
      data: { needsReview: true, categoryId: 'uncategorized' },
    });
    vi.mocked(loadTransferSweepRows).mockResolvedValueOnce(staleRows);

    const res = await applyTransferFlagRepair(USER);
    expect(res).toMatchObject({ ok: true, cleared: 1, skipped: 1, inflowCents: 0, outflowCents: 50_000 });

    const income = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-income` } });
    expect(income.isTransfer).toBe(true); // the re-decided row was skipped, not clobbered
    const run = await prisma.transferFlagRepairRun.findUniqueOrThrow({ where: { id: res.runId! } });
    expect(run.clearedCount).toBe(1);
    expect(run.skippedCount).toBe(1);
    expect((JSON.parse(run.clearedRows) as Array<{ id: string }>).map((r) => r.id)).toEqual([
      `${USER}-card`,
    ]);
  });

  it('UNDO PREMISE (critic P3-7): a row already flagged again is skipped and never counted as restored', async () => {
    await seedFlaggedCorpus();
    const res = await applyTransferFlagRepair(USER);
    // The reader re-marks the card row as a transfer by hand before the undo.
    await prisma.transaction.update({
      where: { id: `${USER}-card` },
      data: { isTransfer: true },
    });
    const undo = await undoTransferFlagRepair(USER, res.runId!);
    expect(undo).toEqual({ ok: true, restored: 1, skipped: 1 });
  });

  it('UNDO IS ATOMIC (critic P1-2): a mid-undo failure rolls the claim back too — no half-restored state behind a refused retry', async () => {
    await seedFlaggedCorpus();
    // A run whose payload throws mid-undo (after the claim, before completion).
    const run = await prisma.transferFlagRepairRun.create({
      data: {
        userId: USER,
        clearedRows: 'not-json{',
        clearedCount: 2,
        inflowCents: 0,
        outflowCents: 0,
      },
    });
    await expect(undoTransferFlagRepair(USER, run.id)).rejects.toThrow();
    // The claim did NOT survive the failure: the run still reads un-undone, so
    // a later (fixed) undo is not refused as "already undone".
    const after = await prisma.transferFlagRepairRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.undoneAt).toBeNull();
  });

  it('UNDO TAKES THE NEWEST RUN ONLY (critic P3-6): an older run\'s id is refused while a newer run stands', async () => {
    await seedFlaggedCorpus();
    const run1 = await applyTransferFlagRepair(USER);
    // Re-mark both rows so a second apply has the same set to clear again.
    await prisma.transaction.updateMany({
      where: { id: { in: [`${USER}-income`, `${USER}-card`] } },
      data: { isTransfer: true },
    });
    const run2 = await applyTransferFlagRepair(USER);
    expect(run2.runId).not.toBeNull();

    const older = await undoTransferFlagRepair(USER, run1.runId!);
    expect(older.ok).toBe(false);
    expect(older.error).toBe('That repair run wasn’t found.');
    // Nothing moved: run2's clears stand.
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-income` } })).isTransfer,
    ).toBe(false);
    // The newest run undoes normally.
    const newest = await undoTransferFlagRepair(USER, run2.runId!);
    expect(newest.ok).toBe(true);
  });

  it('the demo user cannot apply — the shared row is fenced', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: DEMO_USER_ID } } as never);
    const res = await applyTransferFlagRepairAction();
    expect(res.ok).toBe(false);
    expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
  });
});
