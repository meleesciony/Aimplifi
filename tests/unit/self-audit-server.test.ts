/**
 * Self-audit server gather + upsert (TASKS 3.2) against the real DB.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import {
  getLatestSelfAuditSnapshot,
  isAlertNotificationKey,
  recordSelfAuditSnapshot,
  weekStartMonday,
} from '@/server/self-audit';
import { GET } from '@/app/api/cron/audit/route';

const USER = `sa-user-${Date.now()}-${process.pid}`;

function req(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new NextRequest('http://localhost/api/cron/audit', { headers });
}

describe('isAlertNotificationKey', () => {
  it('accepts payment_due and cash_flow_alert; rejects digest', () => {
    expect(isAlertNotificationKey('payment_due:card:2026-06-15')).toBe(true);
    expect(isAlertNotificationKey('cash_flow_alert:2026-06-14')).toBe(true);
    expect(isAlertNotificationKey('weekly_digest:2026-06-09')).toBe(false);
  });
});

describe('server/self-audit + GET /api/cron/audit', () => {
  const today = getProvider().today();
  const weekStart = weekStartMonday(today);
  // The windowed counts (unknown/alert) are queried by a [weekStart, weekStart+7)
  // range, but DEMO_TODAY (pinned by CI at the job level — DECISIONS #58) makes
  // `today`/`weekStart` independent of the real wall clock. Seed rows with an
  // explicit timestamp inside that week instead of relying on the DB's implicit
  // now() default to land there by coincidence (#216-adjacent: CI-only failure,
  // real-DB-timestamp vs pinned-demo-date week mismatch).
  const inWeek = new Date(`${weekStart}T12:00:00.000Z`);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'manual',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 100_000,
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: acct.id,
        date: today,
        amountCents: -5000,
        rawDescriptor: 'COFFEE SHOP',
        status: 'POSTED',
        needsReview: true,
        isTransfer: false,
        isSplitParent: false,
        providerRef: `sa-txn-${process.pid}`,
      },
    });
    await prisma.unknownQuestion.create({
      data: {
        userId: USER,
        scrubbedText: 'blorp the flibbert',
        resolvedIntent: 'unknown',
        createdAt: inWeek,
      },
    });
    await prisma.notificationSent.create({
      data: { userId: USER, key: `payment_due:card:${today}`, sentAt: inWeek },
    });
    await prisma.engagementEvent.create({
      data: {
        userId: USER,
        surface: 'dashboard',
        verb: 'expanded',
        subjectKey: 'radar-assumptions',
        createdAt: inWeek,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    vi.unstubAllEnvs();
  });

  it('upserts rates from gathered counts and returns the latest', async () => {
    const snap = await recordSelfAuditSnapshot(USER, weekStart);
    expect(snap.counts.reviewNeeding).toBe(1);
    expect(snap.counts.reviewTotal).toBe(1);
    expect(snap.reviewRateBps).toBe(10000);
    expect(snap.counts.unknownAttempts).toBe(1);
    expect(snap.counts.unknownStayed).toBe(1);
    expect(snap.unknownRateBps).toBe(10000);
    expect(snap.counts.alertsSent).toBe(1);
    expect(snap.counts.alertsActed).toBe(1);
    expect(snap.alertActRateBps).toBe(10000);

    const latest = await getLatestSelfAuditSnapshot(USER);
    expect(latest?.weekStart).toBe(weekStart);
    expect(latest?.reviewRateBps).toBe(10000);

    const again = await recordSelfAuditSnapshot(USER, weekStart);
    expect(again.id).toBe(snap.id);
    expect(await prisma.selfAuditSnapshot.count({ where: { userId: USER } })).toBe(1);
  });

  it('rejects cron without the secret', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    expect((await GET(req())).status).toBe(401);
  });

  it('cron writes a snapshot for the seeded user', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const body = await (await GET(req('test-secret'))).json();
    expect(body.snapshotsWritten).toBeGreaterThanOrEqual(1);
    const mine = body.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine).toBeTruthy();
    expect(mine.written).toBe(true);
    expect(mine.weekStart).toBe(weekStart);
  });
});
