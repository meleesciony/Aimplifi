/**
 * Notification sweep cron (Gap 2 §2) — drives the REAL GET handler against a
 * throwaway user with an imminent card. Proves: the CRON_SECRET gate; the dormant
 * invariant (no VAPID → candidates found but NOTHING delivered AND NOTHING recorded,
 * so a later opt-in still fires); a real delivery to a live subscription records the
 * dedup key; and a second sweep sends nothing (idempotent). A 404/410 prunes the dead
 * subscription without recording the key.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { setVapidDetails, sendNotification } = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('web-push', () => ({ default: { setVapidDetails, sendNotification } }));

import { GET } from '@/app/api/cron/notify/route';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { addDays } from '@/lib/dates';

function req(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new NextRequest('http://localhost/api/cron/notify', { headers });
}

function configureVapid() {
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub-key');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv-key');
  vi.stubEnv('VAPID_SUBJECT', 'mailto:ops@aimplifi.app');
}

describe('GET /api/cron/notify', () => {
  const USER = `notify-user-${Date.now()}-${process.pid}`;
  const today = getProvider().today();

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    const card = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Imminent Card', type: 'CREDIT', currentBalanceCents: 50_000 },
    });
    await prisma.statement.create({
      data: {
        accountId: card.id,
        cycleStart: addDays(today, -35),
        cycleEnd: addDays(today, -5),
        dueDate: addDays(today, 2), // inside the ≤3-day push window
        statementBalanceCents: 50_000,
        minimumPaymentCents: 2_500,
      },
    });
  });
  afterAll(wipe);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejects a request without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    expect((await GET(req())).status).toBe(401);
  });

  it('dormant (no VAPID): finds a candidate, delivers nothing, records nothing', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const res = await GET(req('test-secret'));
    const body = await res.json();
    expect(body.dormant).toBe(true);
    expect(body.pushesSent).toBe(0);
    const mine = body.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine.candidates).toBeGreaterThanOrEqual(1);
    expect(mine.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
    // CRITICAL: nothing recorded, so a later opt-in still gets this alert.
    expect(await prisma.notificationSent.count({ where: { userId: USER } })).toBe(0);
    // TASKS 1.3: and no value receipt either — nothing was actually delivered.
    expect(await prisma.valueReceipt.count({ where: { userId: USER } })).toBe(0);
  });

  it('configured + subscribed: delivers, records the key, and dedups the next sweep', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    configureVapid();
    await prisma.pushSubscription.create({
      data: { userId: USER, endpoint: 'https://push.example/live', p256dh: 'p', auth: 'a' },
    });
    sendNotification.mockResolvedValue({});

    const first = await (await GET(req('test-secret'))).json();
    expect(first.dormant).toBe(false);
    const mine1 = first.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine1.sent).toBeGreaterThanOrEqual(1);
    expect(sendNotification).toHaveBeenCalled();
    const recorded = await prisma.notificationSent.count({ where: { userId: USER } });
    expect(recorded).toBeGreaterThanOrEqual(1);

    // Second sweep: the key is already recorded → selection excludes it → 0 delivered.
    sendNotification.mockClear();
    const second = await (await GET(req('test-secret'))).json();
    const mine2 = second.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine2.candidates).toBe(0);
    expect(mine2.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
    // No duplicate rows from the second sweep.
    expect(await prisma.notificationSent.count({ where: { userId: USER } })).toBe(recorded);

    // TASKS 1.3: the delivered payment push minted ONE value receipt with the payment
    // amount copied verbatim ($500.00 statement), on the channel-agnostic payment key
    // (so a reminder EMAIL about the same due payment could not double-count it).
    const receipts = await prisma.valueReceipt.findMany({ where: { userId: USER } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].kind).toBe('reminder-delivered');
    expect(receipts[0].amountCents).toBe(50_000);
    expect(receipts[0].key.startsWith('payment_due:')).toBe(true);
  });

  it('a gone (410) subscription is pruned and the key is NOT recorded', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    configureVapid();
    // Fresh state: no prior delivery recorded, one dead subscription.
    await prisma.notificationSent.deleteMany({ where: { userId: USER } });
    await prisma.pushSubscription.deleteMany({ where: { userId: USER } });
    await prisma.pushSubscription.create({
      data: { userId: USER, endpoint: 'https://push.example/dead', p256dh: 'p', auth: 'a' },
    });
    sendNotification.mockRejectedValue({ statusCode: 410 });

    const body = await (await GET(req('test-secret'))).json();
    const mine = body.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine.sent).toBe(0);
    // Dead endpoint pruned; nothing recorded (no live device got it).
    expect(await prisma.pushSubscription.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.notificationSent.count({ where: { userId: USER } })).toBe(0);
    // TASKS 1.3: a phantom send mints no NEW receipt — the count stays at the single
    // receipt the earlier REAL delivery minted (receipts are append-only history, so
    // wiping the dedup log above doesn't touch them).
    expect(await prisma.valueReceipt.count({ where: { userId: USER } })).toBe(1);
  });
});
