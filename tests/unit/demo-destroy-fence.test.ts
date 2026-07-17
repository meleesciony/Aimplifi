/**
 * Demo fence on the account-DESTRUCTIVE actions (#244 critic P1-3). The shared
 * demo account is one row every anonymous visitor logs into: one visitor typing
 * the delete phrase would irreversibly wipe the demo for every other visitor
 * (and brick demo sign-in until a reseed); a session-epoch bump would sign every
 * concurrent visitor out at once. The settings UI hides both controls for demo
 * (locked by account-deletion.spec.ts); these tests lock the server-side guard
 * on the exposed 'use server' endpoints.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { auth, signOut } = await import('@/auth');
const { prisma } = await import('@/lib/db');
const { deleteMyData, revokeOtherSessions } = await import('@/server/account-actions');

function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('test_regression__demo_cannot_destroy_the_shared_account', () => {
  it('deleteMyData refuses the demo user even with the exact phrase; the row survives', async () => {
    actAs(DEMO_USER_ID);
    const fd = new FormData();
    fd.set('confirm', 'DELETE MY DATA'); // the exact phrase — the fence must fire FIRST
    await expect(deleteMyData(fd)).rejects.toThrow(/shared/i);
    // The shared demo row (and its seed) is intact, and nobody was signed out.
    expect(await prisma.user.findUnique({ where: { id: DEMO_USER_ID }, select: { id: true } })).not.toBeNull();
    expect(vi.mocked(signOut)).not.toHaveBeenCalled();
  });

  it('revokeOtherSessions refuses the demo user without bumping the shared epoch', async () => {
    actAs(DEMO_USER_ID);
    const before = await prisma.user.findUnique({
      where: { id: DEMO_USER_ID },
      select: { sessionEpoch: true },
    });
    await expect(revokeOtherSessions()).rejects.toThrow(/shared/i);
    const after = await prisma.user.findUnique({
      where: { id: DEMO_USER_ID },
      select: { sessionEpoch: true },
    });
    expect(after?.sessionEpoch).toBe(before?.sessionEpoch);
    expect(vi.mocked(signOut)).not.toHaveBeenCalled();
  });

  it('the fence is demo-specific: a real user hits the normal confirmation gate', async () => {
    actAs('destroy-fence-real-user');
    const fd = new FormData();
    fd.set('confirm', 'not the phrase');
    // The normal gate answers (wrong phrase), not the demo refusal.
    await expect(deleteMyData(fd)).rejects.toThrow(/confirmation phrase/i);
  });

  it('a real user CAN revoke sessions: the epoch bumps and they are signed out', async () => {
    const USER = `destroy-fence-real-${Date.now()}-${process.pid}`;
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    try {
      actAs(USER);
      const before = await prisma.user.findUnique({ where: { id: USER }, select: { sessionEpoch: true } });
      await revokeOtherSessions();
      const after = await prisma.user.findUnique({ where: { id: USER }, select: { sessionEpoch: true } });
      expect(after!.sessionEpoch).toBe(before!.sessionEpoch + 1);
      expect(vi.mocked(signOut)).toHaveBeenCalledOnce();
    } finally {
      await prisma.user.deleteMany({ where: { id: USER } });
    }
  });
});
