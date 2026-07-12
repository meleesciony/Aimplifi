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
import { recategorizeSharedTransaction } from '@/server/household-actions';
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

describe('slice 6: a household partner\'s correction never becomes ANYONE\'s learned rule (hostile-critic finding)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const OWNER = `learn-owner-${stamp}`;
  const PARTNER = `learn-partner-${stamp}`;
  const ids: string[] = [];

  async function wipe() {
    await prisma.household.deleteMany({ where: { name: `Learn Household ${stamp}` } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, PARTNER] } } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: OWNER, email: `${OWNER}@test.local` } });
    await prisma.user.create({ data: { id: PARTNER, email: `${PARTNER}@test.local` } });
    await prisma.household.create({
      data: {
        name: `Learn Household ${stamp}`,
        members: {
          create: [
            { userId: OWNER, role: 'owner' },
            { userId: PARTNER, role: 'partner' },
          ],
        },
      },
    });
    const acct = await prisma.account.create({
      data: {
        userId: OWNER,
        provider: 'manual',
        name: 'Shared Checking',
        type: 'CHECKING',
        currentBalanceCents: 0,
        currency: 'USD',
        sharedToHousehold: true,
      },
    });
    // Same date-fragmented descriptor twice — exactly the shape that mints a
    // learned rule at the SECOND correction when the corrector owns the row
    // (see the describe block above). Here the corrector is a PARTNER, not
    // the owner.
    for (const d of ['07/01', '08/01']) {
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
  });

  afterAll(wipe);

  it('two consistent partner corrections on the same descriptor mint NO learned rule for the partner or the owner', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: PARTNER } } as never);
    for (const id of ids) {
      const res = await recategorizeSharedTransaction({ transactionId: id, categoryId: 'transfer' });
      expect(res).toEqual({ ok: true });
    }
    // Both corrections landed, attributed to the partner.
    expect(
      await prisma.correction.count({ where: { userId: PARTNER, toCategoryId: 'transfer' } }),
    ).toBe(2);

    // Neither side's loader turns them into a learned rule: the owner's
    // loadCorrectionInputs filters `correction.userId = OWNER` (excludes these
    // partner-attributed rows entirely), and the partner's filters
    // `correction.userId = PARTNER` but then joins `transaction.findMany` scoped
    // to `account: { userId: PARTNER }` — a set these owner-owned transactions
    // are never in.
    const ownerRules = await loadUserRules(OWNER);
    expect(ownerRules.some((r) => r.descriptorSignature === 'CREDIT CARD PAID')).toBe(false);
    const partnerRules = await loadUserRules(PARTNER);
    expect(partnerRules.some((r) => r.descriptorSignature === 'CREDIT CARD PAID')).toBe(false);
  });
});
