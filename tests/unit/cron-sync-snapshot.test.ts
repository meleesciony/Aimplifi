/**
 * TASKS U.4 — the nightly sync cron RECORDS the month's balance point.
 *
 * Drives the REAL `GET` handler (the cron-digest.test.ts idiom) because the
 * wiring is the half a unit test of the writer cannot see: `recordMonthlyBalanceSnapshot`
 * can be perfect and still never run. This is the trigger that reaches every
 * user — `vercel.json` runs `/api/cron/sync` at `0 11 * * *`, and it is the only
 * one a user who never opens the app, or who has no connected bank to sync, will
 * ever get.
 *
 * What it proves:
 *   1. A user swept by the cron ends the run with one dated row per account.
 *   2. The route REPORTS what it wrote (`snapshots`), so a silent no-op is
 *      visible in the response rather than inferred from the database.
 *   3. The shared demo user is swept by nobody and recorded by nobody.
 *   4. A second run the same month writes nothing — the cron is nightly and the
 *      rule is monthly, so idempotence here is what stops 30 buckets a month.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/sync/route';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';

const SECRET = 'test-cron-secret-u4';
const TODAY = '2026-06-10'; // the gate's pinned clock (vitest.config.ts)

function req() {
  return new NextRequest('http://localhost/api/cron/sync', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

describe('GET /api/cron/sync — balance history', () => {
  const USER = `u4-cron-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Mortgage', type: 'LOAN', currentBalanceCents: 31_500_000 },
    });
    await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Checking', type: 'CHECKING', currentBalanceCents: 250_000 },
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await wipe();
  });

  it('records the month for a swept user, and says so in its own response', async () => {
    const demoBefore = await prisma.balanceSnapshot.count({
      where: { account: { userId: DEMO_USER_ID } },
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      snapshots: { userId: string; written?: number; date?: string | null; error?: string }[];
    };

    // 2. The route reports the write rather than leaving it to be inferred.
    const mine = body.snapshots.find((s) => s.userId === USER);
    expect(mine).toEqual({ userId: USER, written: 2, date: TODAY });
    expect(body.snapshots.every((s) => s.error === undefined)).toBe(true);

    // 1. One dated row per account, all on one date.
    const rows = await prisma.balanceSnapshot.findMany({
      where: { account: { userId: USER } },
      select: { date: true, balanceCents: true },
      orderBy: { balanceCents: 'asc' },
    });
    expect(rows).toEqual([
      { date: TODAY, balanceCents: 250_000 },
      { date: TODAY, balanceCents: 31_500_000 },
    ]);

    // 3. The demo row is excluded from the sweep AND fenced in the writer; its
    //    seeded history is exactly as seeded.
    expect(body.snapshots.some((s) => s.userId === DEMO_USER_ID)).toBe(false);
    expect(
      await prisma.balanceSnapshot.count({ where: { account: { userId: DEMO_USER_ID } } }),
    ).toBe(demoBefore);
  });

  it('writes nothing on the next night — the cron is nightly, the rule is monthly', async () => {
    const before = await prisma.balanceSnapshot.count({ where: { account: { userId: USER } } });
    const res = await GET(req());
    const body = (await res.json()) as { snapshots: { userId: string }[] };
    // Nothing written ⇒ no row in the report at all (only writes and errors report).
    expect(body.snapshots.some((s) => s.userId === USER)).toBe(false);
    expect(await prisma.balanceSnapshot.count({ where: { account: { userId: USER } } })).toBe(before);
  });
});
