/**
 * Weekly digest cron (Gap 2 §3) — drives the REAL GET handler against a throwaway user
 * with a card due this week. Proves the CRON_SECRET gate, the dormant invariant (a
 * digest is composed but nothing is sent AND no dedup key is written, so activating
 * email later still delivers), and once-per-week dedup (a real send records the week
 * key; a second run the same week sends nothing).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/digest/route';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { addDays, dayOfWeek } from '@/lib/dates';

function req(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new NextRequest('http://localhost/api/cron/digest', { headers });
}

describe('GET /api/cron/digest', () => {
  const USER = `digest-user-${Date.now()}-${process.pid}`;
  const today = getProvider().today();
  const weekKey = `weekly_digest:${addDays(today, -((dayOfWeek(today) + 6) % 7))}`;

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
        dueDate: addDays(today, 3), // inside the 7-day digest window
        statementBalanceCents: 50_000,
        minimumPaymentCents: 2_500,
      },
    });
  });
  afterAll(wipe);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects a request without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    expect((await GET(req())).status).toBe(401);
  });

  it('dormant (no email key): composes a digest but sends nothing and records nothing', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('RESEND_API_KEY', '');
    const body = await (await GET(req('test-secret'))).json();
    expect(body.dormant).toBe(true);
    expect(body.digestsSent).toBe(0);
    const mine = body.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine.sent).toBe(false);
    expect(mine.reason).toBe('no-provider');
    // Nothing recorded, so activating email later still delivers this week.
    expect(await prisma.notificationSent.count({ where: { userId: USER, key: weekKey } })).toBe(0);
  });

  it('with an email key: sends once, records the week key, and dedups a second run', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    // TASKS 1.3: an existing catch makes the digest carry the cumulative tally line.
    await prisma.valueReceipt.create({
      data: {
        userId: USER,
        kind: 'price-increase',
        key: 'price_increase:Netflix:2026-02-03',
        amountCents: 250,
        label: 'Netflix',
        occurredOn: '2026-02-03',
      },
    });

    const first = await (await GET(req('test-secret'))).json();
    expect(first.dormant).toBe(false);
    const mine1 = first.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine1.sent).toBe(true); // sendEmail returned sent → fetch was called for USER
    expect(fetchSpy).toHaveBeenCalled();

    // The email actually sent to USER contains the caught tally, via the shared lines.
    const userCall = fetchSpy.mock.calls.find((call) => {
      const init = call[1] as { body?: unknown } | undefined;
      return typeof init?.body === 'string' && init.body.includes(`${USER}@test.local`);
    });
    expect(userCall).toBeDefined();
    const sentBody = String((userCall![1] as { body: string }).body);
    expect(sentBody).toContain('running tally of what Aimplifi has caught');
    expect(sentBody).toContain('1 quiet price increase flagged');
    // Exactly one week key recorded for USER (the real send).
    expect(await prisma.notificationSent.count({ where: { userId: USER, key: weekKey } })).toBe(1);

    // Second run the same week → USER is deduped, no duplicate key, not re-sent.
    const second = await (await GET(req('test-secret'))).json();
    const mine2 = second.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine2.sent).toBe(false);
    expect(mine2.reason).toBe('already-sent-this-week');
    expect(await prisma.notificationSent.count({ where: { userId: USER, key: weekKey } })).toBe(1);
  });
});
