/**
 * Concurrency hardening (ROADMAP #9 / STATUS #10) — the Always/Undo orphan-rule
 * race. undoCorrections deletes the rule a correction created; it used to delete
 * by id alone, so if a concurrent re-apply had already handed that rule to a
 * different correction's lineage, the undo would orphan it. The fix deletes the
 * rule ONLY while it still points back to THIS correction (createdFrom === id).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { undoCorrections } from '@/server/triage-actions';
import { prisma } from '@/lib/db';

describe('undoCorrections rule cleanup is lineage-scoped (STATUS #10)', () => {
  const USER = `undo-user-${Date.now()}-${process.pid}`;
  let txnId = '';
  let cat0 = '';
  let cat1 = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  /** A correction that created a priority-100 rule pointing back to it. */
  async function correctionWithRule() {
    const c = await prisma.correction.create({
      data: { userId: USER, transactionId: txnId, fromCategoryId: cat0, toCategoryId: cat1 },
    });
    const r = await prisma.categorizationRule.create({
      data: { userId: USER, categoryId: cat1, priority: 100, createdFrom: c.id },
    });
    await prisma.correction.update({ where: { id: c.id }, data: { becameRuleId: r.id } });
    return { correctionId: c.id, ruleId: r.id };
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const a = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100_000 },
    });
    const cats = await prisma.category.findMany({ take: 2, orderBy: { id: 'asc' } });
    cat0 = cats[0].id;
    cat1 = cats[1].id;
    const t = await prisma.transaction.create({
      data: { accountId: a.id, date: '2026-06-01', amountCents: -2500, rawDescriptor: 'UNDO ME', categoryId: cat1, status: 'POSTED' },
    });
    txnId = t.id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  it('deletes the rule it owns (normal undo)', async () => {
    const { correctionId, ruleId } = await correctionWithRule();
    await undoCorrections([correctionId]);
    expect(await prisma.categorizationRule.findUnique({ where: { id: ruleId } })).toBeNull();
    expect((await prisma.correction.findUnique({ where: { id: correctionId } }))!.becameRuleId).toBeNull();
  });

  it('does NOT delete a rule whose lineage a concurrent re-apply reassigned (no orphan)', async () => {
    const { correctionId, ruleId } = await correctionWithRule();
    // Simulate a concurrent re-apply that handed this rule to a different correction.
    await prisma.categorizationRule.update({ where: { id: ruleId }, data: { createdFrom: 'other-correction' } });
    await undoCorrections([correctionId]);
    // The rule survives — it now belongs to a different correction, not this undo's.
    expect(await prisma.categorizationRule.findUnique({ where: { id: ruleId } })).not.toBeNull();
  });

  it('two concurrent undos of the SAME correction record exactly ONE inverse (no duplicate, STATUS #10)', async () => {
    const c = await prisma.correction.create({
      data: { userId: USER, transactionId: txnId, fromCategoryId: cat0, toCategoryId: cat1 },
    });
    const settled = await Promise.allSettled([undoCorrections([c.id]), undoCorrections([c.id])]);
    // Both resolve — the loser skips idempotently (unique on undoesId) instead of throwing.
    expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);
    // Exactly one inverse correction was recorded for this correction.
    expect(await prisma.correction.count({ where: { undoesId: c.id } })).toBe(1);
  });
});
