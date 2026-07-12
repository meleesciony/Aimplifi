/**
 * Export route auth + durable rate-limit wiring (ROADMAP #8, Critic CQ-1). Drives
 * the REAL GET handler: 401 unauthenticated, 200 under the limit, 429 once the
 * durable per-user limit is exceeded.
 *
 * Also the T8 household lock (HOUSEHOLD_ARCHITECTURE §4.6, slice-8 critic B-1):
 * an export contains ONLY the exporter's own rows — a partner's shared account,
 * though visible on every read surface, never reaches the CSV.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));

import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { GET } from '@/app/api/export/route';
import { prisma } from '@/lib/db';
import { requireViewer, visibleAccountsWhere } from '@/server/authz';

const req = () => new NextRequest('http://localhost/api/export?format=transactions-csv');

describe('GET /api/export (auth + durable rate limit)', () => {
  const USER = `export-user-${Date.now()}-${process.pid}`;
  const KEY = `export:${USER}`;

  async function clearKey() {
    await prisma.rateLimit.deleteMany({ where: { key: KEY } });
  }
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(async () => {
    await clearKey();
    await prisma.user.deleteMany({ where: { id: USER } });
  });
  beforeEach(() => vi.clearAllMocks());

  it('rejects an unauthenticated request with 401', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(req())).status).toBe(401);
  });

  it('serves an authenticated request under the limit (200)', async () => {
    await clearKey();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    expect((await GET(req())).status).toBe(200);
  });

  it('returns 429 once the per-user export limit is exceeded', async () => {
    // Pre-fill the window to the limit (10); the next request increments to 11.
    await prisma.rateLimit.upsert({
      where: { key: KEY },
      create: { key: KEY, count: 10, resetAt: new Date(Date.now() + 60_000) },
      update: { count: 10, resetAt: new Date(Date.now() + 60_000) },
    });
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    expect((await GET(req())).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// T8 — export contains only the exporter's own rows (household fixture).
// Locks against a future "include shared accounts in your export" widening:
// the fixture proves the partner's shared row IS visible through the widened
// read scope, then asserts the CSV still excludes it.
// ---------------------------------------------------------------------------

describe('GET /api/export — T8 household scope', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const EXPORTER = `t8-exporter-${stamp}`;
  const PARTNER = `t8-partner-${stamp}`;
  let sharedAcctId = '';

  async function wipe() {
    const memberships = await prisma.householdMember.findMany({
      where: { userId: { in: [EXPORTER, PARTNER] } },
      select: { householdId: true },
    });
    await prisma.household.deleteMany({
      where: { id: { in: memberships.map((m) => m.householdId) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [EXPORTER, PARTNER] } } });
    await prisma.rateLimit.deleteMany({ where: { key: `export:${EXPORTER}` } });
  }

  beforeAll(async () => {
    await wipe().catch(() => {});
    for (const id of [EXPORTER, PARTNER]) {
      await prisma.user.create({ data: { id, email: `${id}@test.local` } });
    }
    // Membership rows created directly — the invite ceremony is slice-1's lock.
    await prisma.household.create({
      data: {
        name: 'T8 Casa',
        members: {
          create: [
            { userId: EXPORTER, role: 'owner' },
            { userId: PARTNER, role: 'partner' },
          ],
        },
      },
    });
    const own = await prisma.account.create({
      data: {
        userId: EXPORTER, provider: 'simplefin', name: 'Own Checking',
        type: 'CHECKING', currentBalanceCents: 10000, currency: 'USD',
      },
    });
    const shared = await prisma.account.create({
      data: {
        userId: PARTNER, provider: 'simplefin', name: 'Partner Shared Checking',
        type: 'CHECKING', currentBalanceCents: 20000, currency: 'USD',
        sharedToHousehold: true,
      },
    });
    sharedAcctId = shared.id;
    await prisma.transaction.create({
      data: {
        accountId: own.id, date: '2026-07-01', amountCents: -1500,
        rawDescriptor: 'T8 EXPORTER OWN ROW', status: 'POSTED',
        isTransfer: false, isSplitParent: false,
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: shared.id, date: '2026-07-02', amountCents: -2500,
        rawDescriptor: 'T8 PARTNER SHARED ROW', status: 'POSTED',
        isTransfer: false, isSplitParent: false,
      },
    });
  });
  afterAll(wipe);

  it('transactions CSV excludes a partner-SHARED row that the widened read scope DOES see', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: EXPORTER } } as never);

    // Fixture is leak-worthy: the shared account IS visible to the exporter's
    // widened read — if export ever adopted that scope, this row would ship.
    const visible = await prisma.account.findMany({
      where: visibleAccountsWhere(await requireViewer()),
      select: { id: true },
    });
    expect(visible.map((a) => a.id)).toContain(sharedAcctId);

    const res = await GET(
      new NextRequest('http://localhost/api/export?format=transactions-csv'),
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('T8 EXPORTER OWN ROW');
    expect(csv).not.toContain('T8 PARTNER SHARED ROW');
    expect(csv).not.toContain('Partner Shared Checking');
  });
});
