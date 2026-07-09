/**
 * getConnectionAlerts (src/server/connection-health.ts) — the ownership-scoped read that
 * turns persisted per-connection failure signals into dashboard reconnect alerts (Gap 1 §4).
 * Drives the REAL server function against throwaway users with hand-set SimpleFinConnection /
 * PlaidItem rows, proving: a recorded error surfaces exactly one alert; clearing it silences
 * the alert; both providers are covered; and one user never sees another's connection.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getConnectionAlerts } from '@/server/connection-health';
import { prisma } from '@/lib/db';

const USER = `ca-user-${Date.now()}-${process.pid}`;
const OTHER = `ca-other-${Date.now()}-${process.pid}`;

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
}

describe('getConnectionAlerts — persisted failure → reconnect alert', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.createMany({
      data: [
        { id: USER, email: `${USER}@test.local` },
        { id: OTHER, email: `${OTHER}@test.local` },
      ],
    });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    await prisma.simpleFinConnection.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.plaidItem.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  });

  it('no connections → no alerts (demo-safe baseline)', async () => {
    expect(await getConnectionAlerts(USER)).toEqual([]);
  });

  it('a healthy SimpleFIN connection → no alert', async () => {
    await prisma.simpleFinConnection.create({
      data: { userId: USER, accessUrl: 'ct', lastSyncedAt: '2026-06-10', lastSyncAttemptAt: '2026-06-10', lastSyncError: null },
    });
    expect(await getConnectionAlerts(USER)).toEqual([]);
  });

  it('a SimpleFIN connection with a recorded error → exactly one reconnect alert', async () => {
    await prisma.simpleFinConnection.create({
      data: { userId: USER, accessUrl: 'ct', lastSyncedAt: '2026-06-04', lastSyncAttemptAt: '2026-06-08', lastSyncError: 'auth' },
    });
    const alerts = await getConnectionAlerts(USER);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].provider).toBe('SimpleFIN');
    expect(alerts[0].daysSinceAttempt).toBe(2); // 2026-06-08 → 2026-06-10
    expect(alerts[0].message).toMatch(/Reconnect it on the Accounts page/);
    expect(alerts[0].message).not.toContain('auth'); // reason text never surfaced
  });

  it('clearing the error (a later success) silences the alert', async () => {
    await prisma.simpleFinConnection.create({
      data: { userId: USER, accessUrl: 'ct', lastSyncAttemptAt: '2026-06-08', lastSyncError: 'server' },
    });
    expect(await getConnectionAlerts(USER)).toHaveLength(1);
    await prisma.simpleFinConnection.update({
      where: { userId: USER },
      data: { lastSyncedAt: '2026-06-10', lastSyncAttemptAt: '2026-06-10', lastSyncError: null },
    });
    expect(await getConnectionAlerts(USER)).toEqual([]);
  });

  it('a broken Plaid item surfaces with its institution name', async () => {
    await prisma.plaidItem.create({
      data: { userId: USER, itemId: `it-${USER}`, accessToken: 'ct', institution: 'Chase', lastSyncAttemptAt: '2026-06-09', lastSyncError: 'network' },
    });
    const alerts = await getConnectionAlerts(USER);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].provider).toBe('Plaid');
    expect(alerts[0].institution).toBe('Chase');
    expect(alerts[0].message).toContain('Chase (Plaid)');
  });

  it('is ownership-scoped — one user never sees another user\'s broken connection', async () => {
    await prisma.simpleFinConnection.create({
      data: { userId: OTHER, accessUrl: 'ct', lastSyncAttemptAt: '2026-06-09', lastSyncError: 'server' },
    });
    expect(await getConnectionAlerts(USER)).toEqual([]); // OTHER's failure is invisible to USER
    expect(await getConnectionAlerts(OTHER)).toHaveLength(1);
  });
});
