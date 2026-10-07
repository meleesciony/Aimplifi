/**
 * Nudge dismissal store against the real DB (NUDGE_PLAN slice 2, DECISIONS #237).
 * Covers persistence, idempotency, user isolation, and — the load-bearing one — the
 * DEMO FENCE: the shared `user-demo` never writes and always reads empty, so one
 * visitor's "hide this" can never leak to the next (shared-demo-account lesson).
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { getNudgeDismissedKeys, recordNudgeDismissal, removeNudgeDismissal } from '@/server/nudge';

const USER_A = `nd-user-a-${Date.now()}-${process.pid}`;
const USER_B = `nd-user-b-${Date.now()}-${process.pid}`;
const KEY = 'price-increase:Netflix:1799->1999';

describe('server/nudge — dismissal store', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_A, email: `${USER_A}@test.local` } });
    await prisma.user.create({ data: { id: USER_B, email: `${USER_B}@test.local` } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  });

  afterEach(async () => {
    await prisma.nudgeDismissal.deleteMany({ where: { userId: { in: [USER_A, USER_B, DEMO_USER_ID] } } });
  });

  it('persists a dismissal and reads it back', async () => {
    expect(await recordNudgeDismissal(USER_A, KEY)).toBe(true);
    const keys = await getNudgeDismissedKeys(USER_A);
    expect(keys.has(KEY)).toBe(true);
    expect(keys.size).toBe(1);
  });

  it('is idempotent — dismissing twice keeps one row', async () => {
    await recordNudgeDismissal(USER_A, KEY);
    await recordNudgeDismissal(USER_A, KEY);
    expect(await prisma.nudgeDismissal.count({ where: { userId: USER_A } })).toBe(1);
    expect((await getNudgeDismissedKeys(USER_A)).has(KEY)).toBe(true);
  });

  it('rejects an empty key without writing', async () => {
    expect(await recordNudgeDismissal(USER_A, '')).toBe(false);
    expect(await prisma.nudgeDismissal.count({ where: { userId: USER_A } })).toBe(0);
  });

  it('rejects an over-length key without writing (P1-3: no megabyte keys)', async () => {
    expect(await recordNudgeDismissal(USER_A, 'x'.repeat(201))).toBe(false);
    expect(await prisma.nudgeDismissal.count({ where: { userId: USER_A } })).toBe(0);
    // A key at the 200-char boundary is still accepted.
    expect(await recordNudgeDismissal(USER_A, 'y'.repeat(200))).toBe(true);
  });

  it('isolates users — B never sees A’s dismissal', async () => {
    await recordNudgeDismissal(USER_A, KEY);
    expect((await getNudgeDismissedKeys(USER_B)).size).toBe(0);
  });

  describe('demo fence (shared-demo-account-must-not-learn)', () => {
    it('never WRITES for the demo user', async () => {
      expect(await recordNudgeDismissal(DEMO_USER_ID, KEY)).toBe(false);
      expect(await prisma.nudgeDismissal.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    });

    it('always READS empty for the demo user — even if a row somehow exists', async () => {
      // Force a row past the write fence to prove the READ fence is independent: a
      // stray demo row (bug, migration, manual insert) must still never suppress a
      // visitor's feed. Direct prisma write bypasses recordNudgeDismissal on purpose.
      await prisma.nudgeDismissal.create({ data: { userId: DEMO_USER_ID, dismissKey: KEY } });
      expect((await getNudgeDismissedKeys(DEMO_USER_ID)).size).toBe(0);
    });
  });
});

// DECISIONS #795 — Undo on the feed's confirmation line.
describe('server/nudge — removeNudgeDismissal (undo)', () => {
  const USER_U = `nd-user-u-${Date.now()}-${process.pid}`;
  const USER_V = `nd-user-v-${Date.now()}-${process.pid}`;
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_U, email: `${USER_U}@test.local` } });
    await prisma.user.create({ data: { id: USER_V, email: `${USER_V}@test.local` } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [USER_U, USER_V] } } });
  });
  afterEach(async () => {
    await prisma.nudgeDismissal.deleteMany({ where: { userId: { in: [USER_U, USER_V] } } });
  });

  it('undoes exactly the one user’s one key, and nothing else', async () => {
    await recordNudgeDismissal(USER_U, KEY);
    await recordNudgeDismissal(USER_U, 'unusual_charge:txn-1');
    await recordNudgeDismissal(USER_V, KEY);
    expect(await removeNudgeDismissal(USER_U, KEY)).toBe(true);
    expect((await getNudgeDismissedKeys(USER_U)).has(KEY)).toBe(false);
    expect((await getNudgeDismissedKeys(USER_U)).has('unusual_charge:txn-1')).toBe(true);
    expect((await getNudgeDismissedKeys(USER_V)).has(KEY)).toBe(true);
  });

  it('undoing a key that was never dismissed is still success; the demo and a bad key are refused', async () => {
    expect(await removeNudgeDismissal(USER_U, KEY)).toBe(true);
    expect(await removeNudgeDismissal(DEMO_USER_ID, KEY)).toBe(false);
    expect(await removeNudgeDismissal(USER_U, '')).toBe(false);
    expect(await removeNudgeDismissal(USER_U, 'k'.repeat(201))).toBe(false);
  });
});
