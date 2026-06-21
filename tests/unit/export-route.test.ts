/**
 * Export route auth + durable rate-limit wiring (ROADMAP #8, Critic CQ-1). Drives
 * the REAL GET handler: 401 unauthenticated, 200 under the limit, 429 once the
 * durable per-user limit is exceeded.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));

import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { GET } from '@/app/api/export/route';
import { prisma } from '@/lib/db';

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
