/**
 * Glass-Box slice 2b — the correction chip's write path (GLASSBOX_PLAN §2b),
 * driven through the REAL server actions against throwaway data (never the
 * seeded demo user; the e2e stays render-only for the same reason — a persisted
 * correction in the shared demo DB would perturb parallel specs, the #182
 * session-revoke precedent).
 *
 * The full loop it proves: ask → a spend answer whose trace rows carry txnIds →
 * `correctFromAsk` re-files ONE row via the proven triage `applyCategory`
 * (append-only Correction, no rule minted) → the returned re-dispatched answer
 * shows the figure moved by exactly that row's contribution, reconciled →
 * `undoAskCorrection` restores category + figure (inverse Correction, audit =
 * state). Plus the gates: foreign transaction → throws; non-correctable /
 * malformed intent → throws before any write.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
// revalidatePath needs a Next request store absent in unit tests — no-op it.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/** Armed fault for the critic-F1 lock: the NEXT getFinanceSnapshot throws once,
 *  simulating a recompute failure AFTER the correction committed. */
const snapshotFault = vi.hoisted(() => ({ armed: false }));
vi.mock('@/lib/providers/demo', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/providers/demo')>();
  return {
    ...mod,
    getProvider: () => {
      const p = mod.getProvider();
      return new Proxy(p, {
        get(target, prop, recv) {
          if (prop === 'getFinanceSnapshot') {
            return (userId: string) => {
              if (snapshotFault.armed) {
                snapshotFault.armed = false;
                throw new Error('injected snapshot fault');
              }
              return target.getFinanceSnapshot(userId);
            };
          }
          return Reflect.get(target, prop, recv);
        },
      });
    },
  };
});

import { auth } from '@/auth';
import { askAssistant, correctFromAsk, undoAskCorrection } from '@/server/assistant';
import { prisma } from '@/lib/db';

const TODAY = '2026-06-10';

describe('correctFromAsk / undoAskCorrection (real actions, throwaway data)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `ask-corr-user-${stamp}`;
  const OTHER = `ask-corr-other-${stamp}`;
  let petcoId = '';
  let priorDemoToday: string | undefined;

  const asUser = (id: string) =>
    vi.mocked(auth).mockResolvedValue({ user: { id } } as never);

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  }

  beforeAll(async () => {
    // Pin business "today" so `this month` is June 2026, matching the fixtures
    // (businessToday precedence 1 — the same pin every golden test uses).
    priorDemoToday = process.env.DEMO_TODAY;
    process.env.DEMO_TODAY = TODAY;
    await wipe();
    for (const c of [
      { id: 'groceries', name: 'Groceries' },
      { id: 'pets', name: 'Pets' },
    ]) {
      await prisma.category.upsert({ where: { id: c.id }, update: {}, create: { id: c.id, name: c.name, isSystem: true } });
    }
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100000 },
    });
    // Two real groceries rows + one PETCO row MISFILED as groceries → 10000 total.
    for (const [i, t] of [
      { date: '2026-06-02', amountCents: -5000, rawDescriptor: 'KROGER #529' },
      { date: '2026-06-05', amountCents: -3000, rawDescriptor: 'KROGER #529' },
      { date: '2026-06-07', amountCents: -2000, rawDescriptor: 'PETCO 1234' },
    ].entries()) {
      const row = await prisma.transaction.create({
        data: { accountId: acct.id, categoryId: 'groceries', status: 'POSTED', isTransfer: false, needsReview: false, ...t },
      });
      if (i === 2) petcoId = row.id;
    }
  });

  afterAll(async () => {
    await wipe();
    if (priorDemoToday === undefined) delete process.env.DEMO_TODAY;
    else process.env.DEMO_TODAY = priorDemoToday;
  });

  it('full loop: figure moves by exactly the corrected row, reconciled; undo restores it', async () => {
    asUser(USER);

    // BEFORE: the real ask path — 10000, reconciled, rows keyed by txnId.
    const before = await askAssistant('how much did I spend on groceries this month');
    expect(before.kind).toBe('spend_by_category');
    expect(before.headlineCents).toBe(10000);
    expect(before.trace?.kind).toBe('row_sum');
    const beforeTrace = before.trace!.kind === 'row_sum' ? before.trace! : null;
    expect(beforeTrace!.reconciled).toBe(true);
    expect(beforeTrace!.rows.map((r) => r.txnId)).toContain(petcoId);
    expect(before.intent).toBeDefined();

    // CORRECT the misfiled PETCO row → Pets.
    const corrected = await correctFromAsk({ transactionId: petcoId, toCategoryId: 'pets', intent: before.intent });
    expect(corrected.answer).not.toBeNull(); // the happy path returns the refreshed answer
    const after = corrected.answer!;
    expect(after.headlineCents).toBe(8000); // 10000 − 2000, exactly the row
    expect(after.trace?.kind).toBe('row_sum');
    if (after.trace?.kind === 'row_sum') {
      expect(after.trace.reconciled).toBe(true);
      expect(after.trace.rows.map((r) => r.txnId)).not.toContain(petcoId);
    }
    expect(after.intent).toEqual(before.intent); // re-dispatch echoes the same frame

    // The write: append-only Correction, transaction re-filed, NO rule minted.
    const correction = await prisma.correction.findUnique({ where: { id: corrected.correctionId } });
    expect(correction).toMatchObject({ userId: USER, transactionId: petcoId, fromCategoryId: 'groceries', toCategoryId: 'pets' });
    const txn = await prisma.transaction.findUnique({ where: { id: petcoId } });
    expect(txn?.categoryId).toBe('pets');
    expect(txn?.needsReview).toBe(false);
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0); // Ask never mints a durable rule

    // UNDO: inverse Correction, category + figure restored.
    const undone = await undoAskCorrection({ correctionId: corrected.correctionId, intent: before.intent });
    expect(undone.answer?.headlineCents).toBe(10000);
    const restored = await prisma.transaction.findUnique({ where: { id: petcoId } });
    expect(restored?.categoryId).toBe('groceries');
    expect(restored?.needsReview).toBe(true); // triage undo semantics: back to review, honestly undecided
    const inverse = await prisma.correction.findFirst({ where: { undoesId: corrected.correctionId } });
    expect(inverse).toMatchObject({ fromCategoryId: 'pets', toCategoryId: 'groceries' });
  });

  it('a recompute failure AFTER the committed write is disclosed, never a false failure (critic 2b F1)', async () => {
    asUser(USER);
    const before = await askAssistant('how much did I spend on groceries this month');
    expect(before.headlineCents).toBe(10000);

    // The NEXT snapshot read — the post-write recompute — throws.
    snapshotFault.armed = true;
    const res = await correctFromAsk({ transactionId: petcoId, toCategoryId: 'pets', intent: before.intent });
    // No thrown "failure", no fabricated answer: the split is disclosed as
    // { answer: null, correctionId } so the client can close its panels and
    // keep the undo handle — while the write really did commit.
    expect(res.answer).toBeNull();
    expect(res.correctionId).toBeTruthy();
    const txn = await prisma.transaction.findUnique({ where: { id: petcoId } });
    expect(txn?.categoryId).toBe('pets');

    // Unarmed undo restores state and answer alike.
    const undone = await undoAskCorrection({ correctionId: res.correctionId, intent: before.intent });
    expect(undone.answer?.headlineCents).toBe(10000);
    expect((await prisma.transaction.findUnique({ where: { id: petcoId } }))?.categoryId).toBe('groceries');
  });

  it('a foreign transaction is refused by ownership (no write)', async () => {
    asUser(USER);
    const before = await askAssistant('how much did I spend on groceries this month');
    asUser(OTHER);
    await expect(
      correctFromAsk({ transactionId: petcoId, toCategoryId: 'pets', intent: before.intent }),
    ).rejects.toThrow('Transaction not found');
    const corrections = await prisma.correction.count({ where: { userId: OTHER } });
    expect(corrections).toBe(0);
  });

  it('a non-correctable or malformed intent is refused BEFORE any write', async () => {
    asUser(USER);
    const preCount = await prisma.correction.count({ where: { userId: USER } });
    await expect(
      correctFromAsk({ transactionId: petcoId, toCategoryId: 'pets', intent: { kind: 'net_worth' } }),
    ).rejects.toThrow('does not support corrections');
    await expect(
      correctFromAsk({ transactionId: petcoId, toCategoryId: 'pets', intent: { kind: 'nonsense' } }),
    ).rejects.toThrow('does not support corrections');
    await expect(
      undoAskCorrection({ correctionId: 'whatever', intent: null }),
    ).rejects.toThrow('does not support corrections');
    expect(await prisma.correction.count({ where: { userId: USER } })).toBe(preCount);
  });
});
