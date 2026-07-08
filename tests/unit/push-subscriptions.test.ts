/**
 * Push subscription persistence (Gap 2 §2) — the per-user cap (critic P2-2) that
 * stops an attacker from registering unlimited endpoints to starve the serial notify
 * sweep. Drives the REAL savePushSubscription against a throwaway user.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { savePushSubscription, deletePushSubscription } from '@/server/push-subscriptions';

describe('savePushSubscription', () => {
  const USER = `push-sub-user-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);

  it('is idempotent per endpoint (re-subscribe upserts, does not duplicate)', async () => {
    await savePushSubscription(USER, { endpoint: 'https://push.example/dup', p256dh: 'p1', auth: 'a1' });
    await savePushSubscription(USER, { endpoint: 'https://push.example/dup', p256dh: 'p2', auth: 'a2' });
    const rows = await prisma.pushSubscription.findMany({ where: { userId: USER, endpoint: 'https://push.example/dup' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe('p2'); // refreshed
    await deletePushSubscription(USER, 'https://push.example/dup');
  });

  it('caps the per-user set at 20, evicting the oldest', async () => {
    for (let i = 0; i < 25; i += 1) {
      await savePushSubscription(USER, { endpoint: `https://push.example/e${i}`, p256dh: 'p', auth: 'a' });
    }
    const count = await prisma.pushSubscription.count({ where: { userId: USER } });
    expect(count).toBe(20); // capped
    // The just-added device must never be the one evicted (newest survives).
    expect(await prisma.pushSubscription.count({ where: { userId: USER, endpoint: 'https://push.example/e24' } })).toBe(1);
    // Exactly 5 of the 25 were evicted (oldest-first by createdAt).
    const survivors = await prisma.pushSubscription.count({ where: { userId: USER } });
    expect(survivors).toBe(20);
  });
});
