/**
 * saveRetirementAge — integration test against a throwaway user (DECISIONS #131).
 *
 * Proves the security/no-fabrication contract: the client sends ONLY the age (no derived
 * figure). The server re-validates it against DIAL_LIMITS.retirementAge [18,110] AND the
 * cross-field ordering (current ≤ retirement < plan-through) before persisting to the
 * existing User.retirementAge dial (option (a) — no flat Goal that would contradict the
 * compounding engine). Rejects an out-of-range / out-of-order age without mutating the row,
 * and requires an authenticated session.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { saveRetirementAge } from '@/server/goal-actions';
import { prisma } from '@/lib/db';

describe('saveRetirementAge (real, throwaway user — DECISIONS #131)', () => {
  const USER = `rage-user-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  async function retirementAge(): Promise<number | null> {
    const row = await prisma.user.findUnique({ where: { id: USER }, select: { retirementAge: true } });
    return row?.retirementAge ?? null;
  }

  beforeAll(async () => {
    await wipe();
    // currentAge 40, endAge 95 fixed so the cross-field ordering is deterministically testable.
    await prisma.user.create({
      data: { id: USER, email: `${USER}@test.local`, currentAge: 40, endAge: 95, retirementAge: 65 },
    });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.user.update({ where: { id: USER }, data: { retirementAge: 65 } }); // reset baseline
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
  });

  it('persists a valid age to User.retirementAge and writes an audit row', async () => {
    await saveRetirementAge(60);
    expect(await retirementAge()).toBe(60);
    const audits = await prisma.auditLog.findMany({ where: { userId: USER, action: 'settings.dials.update' } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('rounds a near-integer age (client number is never trusted raw)', async () => {
    await saveRetirementAge(60.4 as number);
    expect(await retirementAge()).toBe(60);
  });

  it('rejects an out-of-range / non-integer age without mutating the row', async () => {
    for (const bad of [12, 130, 17, 111]) {
      await expect(saveRetirementAge(bad)).rejects.toThrow(/invalid retirement age/i);
    }
    // A non-integer that ROUNDS out of range is still rejected (round happens before the bounds check).
    await expect(saveRetirementAge(110.6)).rejects.toThrow(/invalid retirement age/i);
    expect(await retirementAge()).toBe(65); // unchanged
  });

  it('rejects an age before the current age (cross-field ordering) without mutating', async () => {
    await expect(saveRetirementAge(35)).rejects.toThrow(/before your current age/i);
    expect(await retirementAge()).toBe(65);
  });

  it('rejects an age at/after the plan-through age without mutating', async () => {
    await expect(saveRetirementAge(95)).rejects.toThrow(/plan-through age must be after/i);
    await expect(saveRetirementAge(96)).rejects.toThrow(/plan-through age must be after/i);
    expect(await retirementAge()).toBe(65);
  });

  it('requires an authenticated session', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(saveRetirementAge(60)).rejects.toThrow();
    expect(await retirementAge()).toBe(65); // untouched
  });
});
