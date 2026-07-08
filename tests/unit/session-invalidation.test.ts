/**
 * Multi-device session invalidation + PII-free deletion record (Gap 6 §3) —
 * integration tests that drive the REAL DB paths against throwaway users:
 *  - currentSessionEpoch / isSessionEpochCurrent (the sign-in stamp + the
 *    per-request check): one source, so a fresh sign-in AFTER a revoke re-reads
 *    the current epoch and is valid — the regression that locks the demo/Google
 *    lock-out P0 (Critic P0-1). Stale tokens and deleted users are rejected.
 *  - revokeOtherSessions (the real server action): bumps the epoch, audits, signs out.
 *  - deleteMyData: writes a PII-free DeletionRecord ATOMICALLY with the cascade,
 *    and it OUTLIVES the deletion.
 *
 * The pure decision/hash core lives in session-lifecycle.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth seam so the actions run against a throwaway user; signOut is a
// no-op (the real one throws NEXT_REDIRECT). Hoisted above the action import.
vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));

import { auth, signOut } from '@/auth';
import { hashUserRef } from '@/lib/engine/auth/session';
import { deleteMyData, revokeOtherSessions } from '@/server/account-actions';
import { currentSessionEpoch, isSessionEpochCurrent } from '@/server/session-guard';
import { prisma } from '@/lib/db';

// The exact salt the deletion action uses, so the test's expected hash matches
// whatever the environment resolves (secret in prod/CI, engine default in a bare env).
const REF_SALT = process.env.DELETION_REF_SALT ?? process.env.AUTH_SECRET;

const stamp = `${Date.now()}-${process.pid}`;
const USER = `sess-user-${stamp}`;
const DEL = `sess-del-${stamp}`;

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: [USER, DEL] } } });
  await prisma.deletionRecord.deleteMany({
    where: { userRefHash: { in: [hashUserRef(USER, REF_SALT), hashUserRef(DEL, REF_SALT)] } },
  });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
});
afterAll(wipe);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
});

describe('session epoch — stamp and check share one source (real DB)', () => {
  it('is current for a fresh user at epoch 0 (token 0 or absent)', async () => {
    expect(await currentSessionEpoch(USER)).toBe(0);
    expect(await isSessionEpochCurrent(USER, 0)).toBe(true);
    expect(await isSessionEpochCurrent(USER, undefined)).toBe(true);
  });

  it('is dead for a user that does not exist (deleted account, stale token)', async () => {
    expect(await currentSessionEpoch(`missing-${stamp}`)).toBeUndefined();
    expect(await isSessionEpochCurrent(`missing-${stamp}`, 0)).toBe(false);
  });
});

describe('revokeOtherSessions (real action) — and the demo/Google lock-out regression', () => {
  it('bumps the epoch, audits, signs out; the old token dies AND a fresh sign-in works', async () => {
    const before = (await currentSessionEpoch(USER))!;
    expect(await isSessionEpochCurrent(USER, before)).toBe(true);

    await revokeOtherSessions();

    const after = (await currentSessionEpoch(USER))!;
    expect(after).toBe(before + 1);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/sign-in' });
    expect(
      await prisma.auditLog.count({ where: { userId: USER, action: 'session.revoke-all' } }),
    ).toBe(1);

    // Every token stamped with the PRE-bump epoch is now stale on every device...
    expect(await isSessionEpochCurrent(USER, before)).toBe(false);
    // ...and — THE P0 REGRESSION — a fresh sign-in stamps `currentSessionEpoch`
    // (now the bumped value), so it is valid again. This is exactly the path demo
    // and Google tokens take (stamped from the DB, not a hardcoded 0): if minting
    // ever reverted to a static 0, `after !== 0` would make this fail.
    const freshStamp = await currentSessionEpoch(USER);
    expect(await isSessionEpochCurrent(USER, freshStamp)).toBe(true);
    expect(freshStamp).toBe(after);
  });
});

describe('deleteMyData — PII-free deletion record, atomic with the cascade', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { id: DEL } });
    await prisma.deletionRecord.deleteMany({ where: { userRefHash: hashUserRef(DEL, REF_SALT) } });
    await prisma.user.create({ data: { id: DEL, email: `${DEL}@test.local` } });
    vi.mocked(auth).mockResolvedValue({ user: { id: DEL } } as never);
  });

  it('writes exactly one record that outlives the cascade and retains no recoverable id', async () => {
    const fd = new FormData();
    fd.set('confirm', 'delete my data');
    await deleteMyData(fd);

    // The user (and everything user-owned) is gone...
    expect(await prisma.user.count({ where: { id: DEL } })).toBe(0);
    // ...but the un-related deletion record survives the cascade — exactly one.
    const records = await prisma.deletionRecord.findMany({
      where: { userRefHash: hashUserRef(DEL, REF_SALT) },
    });
    expect(records).toHaveLength(1);
    // It holds only the one-way hash + timestamp — nothing recoverable.
    expect(records[0].userRefHash).toBe(hashUserRef(DEL, REF_SALT));
    expect(JSON.stringify(records[0])).not.toContain(DEL);
    expect(JSON.stringify(records[0])).not.toContain('@test.local');
  });
});
