/**
 * Learn-from-corrections wiring (DECISIONS #161) — end-to-end against the REAL
 * `recategorize` action + `loadUserRules`, on throwaway data (never the demo
 * user). Proves the owner's actual gesture closes the loop: correcting the same
 * date-fragmented descriptor to `transfer` twice (scope 'one', which writes only
 * a Correction — no rule) makes loadUserRules DERIVE a learned rule that
 * categorize() then applies to next month's brand-new transaction. One
 * correction is not enough; the learned rule appears only at the 2nd.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { recategorize } from '@/server/triage-actions';
import { loadUserRules } from '@/server/rules';
import { categorize } from '@/lib/engine/categorize/pipeline';

describe('learned rules from real corrections (throwaway data — DECISIONS #161)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `learn-user-${stamp}`;
  const ids: string[] = [];

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    for (const c of [
      { id: 'transfer', name: 'Transfer' },
      { id: 'uncategorized', name: 'Uncategorized' },
    ]) {
      await prisma.category.upsert({ where: { id: c.id }, update: {}, create: { id: c.id, name: c.name, isSystem: true } });
    }
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    // Three months of the SAME date-fragmented descriptor — three different
    // canonicals ("Credit Card Paid 07/01" …), the exact case a canonical rule
    // can't express. All start in review.
    for (const d of ['07/01', '08/01', '09/01']) {
      const t = await prisma.transaction.create({
        data: {
          accountId: acct.id,
          date: `2026-${d.slice(0, 2)}-${d.slice(3)}`,
          amountCents: -80000,
          rawDescriptor: `CREDIT CARD PAID ${d}`,
          categoryId: 'uncategorized',
          needsReview: true,
        },
      });
      ids.push(t.id);
    }
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  afterAll(wipe);

  it('one correction is not enough to learn', async () => {
    await recategorize({ transactionId: ids[0], categoryId: 'transfer', scope: 'one' });
    const rules = await loadUserRules(USER);
    expect(rules.some((r) => r.descriptorSignature === 'CREDIT CARD PAID')).toBe(false);
  });

  it('the SECOND consistent correction mints a learned rule that categorize applies', async () => {
    await recategorize({ transactionId: ids[1], categoryId: 'transfer', scope: 'one' });
    const rules = await loadUserRules(USER);

    const learned = rules.find((r) => r.descriptorSignature === 'CREDIT CARD PAID');
    expect(learned).toBeDefined();
    expect(learned!.categoryId).toBe('transfer');

    // September's row — never corrected, a fresh id — now auto-files as transfer.
    const out = categorize(
      { rawDescriptor: 'CREDIT CARD PAID 09/01', amountCents: -80000, date: '2026-09-01', accountId: 'acct' },
      rules,
    );
    expect(out.categoryId).toBe('transfer');
    expect(out.source).toBe('user-rule');
    expect(out.needsReview).toBe(false);
  });
});
