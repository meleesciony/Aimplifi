/**
 * Account-deletion — the pure gate/summary engine PLUS an integration test that
 * exercises the real `deleteMyData` server action (not a re-implementation of
 * its effect) against throwaway users, proving the server-side confirmation
 * gate, the ownership-scoped cascade, idempotency, and sign-out.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth seam so the action runs against a throwaway user, and signOut is
// a no-op (the real one throws a NEXT_REDIRECT). Hoisted above the action import.
vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));

import { auth, signOut } from '@/auth';
import {
  DELETE_CONFIRMATION_PHRASE,
  confirmationMatches,
  deletionSummary,
} from '@/lib/engine/account/deletion';
import { deleteMyData } from '@/server/account-actions';
import { prisma } from '@/lib/db';

describe('confirmationMatches', () => {
  it('accepts the exact phrase, case-insensitively and trimmed', () => {
    expect(confirmationMatches('delete my data')).toBe(true);
    expect(confirmationMatches('DELETE MY DATA')).toBe(true);
    expect(confirmationMatches('  Delete My Data  ')).toBe(true);
    expect(confirmationMatches(DELETE_CONFIRMATION_PHRASE)).toBe(true);
  });
  it('rejects anything else — a half-typed, extra, or wrong phrase', () => {
    expect(confirmationMatches('delete')).toBe(false);
    expect(confirmationMatches('delete my data!')).toBe(false);
    expect(confirmationMatches('delete all my data')).toBe(false);
    expect(confirmationMatches('')).toBe(false);
    expect(confirmationMatches('   ')).toBe(false);
  });
});

describe('deletionSummary', () => {
  it('labels each non-zero count and omits the empties', () => {
    expect(
      deletionSummary({ accounts: 4, transactions: 842, statements: 12, goals: 0, budgets: 0, rules: 3 }),
    ).toEqual([
      { label: 'linked accounts', count: 4 },
      { label: 'transactions', count: 842 },
      { label: 'statements', count: 12 },
      { label: 'categorization rules', count: 3 },
    ]);
  });
  it('returns [] when there is nothing to remove', () => {
    expect(
      deletionSummary({ accounts: 0, transactions: 0, statements: 0, goals: 0, budgets: 0, rules: 0 }),
    ).toEqual([]);
  });
});

/**
 * Integration: drive the REAL deleteMyData action. Unique per-run ids + a wipe
 * guard make it deterministic; it only ever touches its own throwaway users,
 * never the seeded `user-demo`, and cleans up. Covers the direct (Goal, AuditLog)
 * and two-level (User→Account→Transaction) cascade chains; every other user-owned
 * relation shares the identical `onDelete: Cascade` (prisma/schema.prisma).
 */
describe('deleteMyData (integration — real action against throwaway users)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const DOOMED = `del-doomed-${stamp}`;
  const SURVIVOR = `del-survivor-${stamp}`;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: { in: [DOOMED, SURVIVOR] } } });
  }
  async function seedUser(id: string) {
    await prisma.user.create({ data: { id, email: `${id}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: id, provider: 'demo', name: 'Test', type: 'CHECKING', currentBalanceCents: 0 },
    });
    await prisma.transaction.create({
      data: { accountId: acct.id, date: '2026-06-01', amountCents: -1000, rawDescriptor: 'TEST TXN' },
    });
    await prisma.goal.create({ data: { userId: id, name: 'G', targetCents: 1000, savedCents: 0 } });
    await prisma.auditLog.create({ data: { userId: id, action: 'test.seed', meta: '{}' } });
  }
  const formData = (confirm: string) => {
    const fd = new FormData();
    fd.set('confirm', confirm);
    return fd;
  };

  beforeAll(async () => {
    await wipe();
    await seedUser(DOOMED);
    await seedUser(SURVIVOR);
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: DOOMED } } as never);
  });

  it('rejects a wrong confirmation phrase server-side and deletes nothing', async () => {
    await expect(deleteMyData(formData('not the phrase'))).rejects.toThrow(/confirmation phrase/i);
    expect(await prisma.user.count({ where: { id: DOOMED } })).toBe(1);
    expect(await prisma.account.count({ where: { userId: DOOMED } })).toBe(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('with the exact phrase: wipes the caller’s whole graph, leaves others, signs out', async () => {
    await deleteMyData(formData('delete my data'));

    expect(await prisma.user.count({ where: { id: DOOMED } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: DOOMED } })).toBe(0);
    expect(await prisma.transaction.count({ where: { account: { userId: DOOMED } } })).toBe(0);
    expect(await prisma.goal.count({ where: { userId: DOOMED } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId: DOOMED } })).toBe(0);

    // Ownership-scoped: the other user is untouched.
    expect(await prisma.account.count({ where: { userId: SURVIVOR } })).toBe(1);
    expect(await prisma.goal.count({ where: { userId: SURVIVOR } })).toBe(1);

    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/sign-in' });
  });

  it('is idempotent — a second delete (row already gone) signs out without throwing', async () => {
    await expect(deleteMyData(formData('delete my data'))).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalled();
  });
});
