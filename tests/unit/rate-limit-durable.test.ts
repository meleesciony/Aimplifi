/**
 * Durable rate limiter + sign-in throttle (ROADMAP #8). The DB-backed limiter
 * holds across instances (the in-memory one is a per-instance no-op on
 * serverless), and the sign-in action throttles repeated attempts per account.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
// next-auth's index pulls `next/server`, which vitest's node resolver can't load
// (fine in the Next build). We only need AuthError to exist for the import.
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));

import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { pruneExpiredRateLimits, rateLimitDurable } from '@/server/authz';
import { signInWithPassword } from '@/server/auth-actions';
import { prisma } from '@/lib/db';

describe('rateLimitDurable (DB-backed, multi-instance)', () => {
  const KEY = `test:rl:${Date.now()}:${process.pid}`;
  afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: KEY } });
  });

  it('allows up to the limit, then rejects within the window', async () => {
    expect(await rateLimitDurable(KEY, 3, 60_000)).toBe(true); // 1
    expect(await rateLimitDurable(KEY, 3, 60_000)).toBe(true); // 2
    expect(await rateLimitDurable(KEY, 3, 60_000)).toBe(true); // 3
    expect(await rateLimitDurable(KEY, 3, 60_000)).toBe(false); // 4 — over
    expect(await rateLimitDurable(KEY, 3, 60_000)).toBe(false); // still over
  });

  it('resets to a fresh allowance once the window has expired', async () => {
    // Force the persisted window into the past, then the next call resets it.
    await prisma.rateLimit.update({ where: { key: KEY }, data: { resetAt: new Date(Date.now() - 1000) } });
    expect(await rateLimitDurable(KEY, 3, 60_000)).toBe(true); // new window, count 1
    const row = await prisma.rateLimit.findUnique({ where: { key: KEY } });
    expect(row!.count).toBe(1);
  });

  it('a CONCURRENT burst of first-hits allows AT MOST the limit (atomic — Critic CONC-1/SEC-1)', async () => {
    // The old read-then-set-1 design let every concurrent first-hit return true
    // (a full bypass). The atomic increment-or-create caps it at exactly `limit`.
    const BURST = `test:rl:burst:${Date.now()}:${process.pid}`;
    const results = await Promise.all(Array.from({ length: 12 }, () => rateLimitDurable(BURST, 4, 60_000)));
    expect(results.filter(Boolean).length).toBe(4); // not 12
    await prisma.rateLimit.deleteMany({ where: { key: BURST } });
  });

  it('pruneExpiredRateLimits deletes expired rows and keeps live ones', async () => {
    const stamp = `${Date.now()}:${process.pid}`;
    const expired = `test:rl:exp:${stamp}`;
    const live = `test:rl:live:${stamp}`;
    await prisma.rateLimit.create({ data: { key: expired, count: 9, resetAt: new Date(Date.now() - 5_000) } });
    await prisma.rateLimit.create({ data: { key: live, count: 1, resetAt: new Date(Date.now() + 60_000) } });
    await pruneExpiredRateLimits(new Date());
    expect(await prisma.rateLimit.findUnique({ where: { key: expired } })).toBeNull();
    expect(await prisma.rateLimit.findUnique({ where: { key: live } })).not.toBeNull();
    await prisma.rateLimit.deleteMany({ where: { key: { in: [expired, live] } } });
  });
});

describe('signInWithPassword throttle (ROADMAP #8)', () => {
  const EMAIL = `throttle-${Date.now()}-${process.pid}@test.local`;
  function fd(email: string, password: string) {
    const f = new FormData();
    f.set('email', email);
    f.set('password', password);
    return f;
  }
  afterEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: `signin:${EMAIL}` } });
  });
  beforeEach(() => {
    // Every attempt "fails" as a bad credential (AuthError), so signIn never redirects.
    vi.mocked(signIn).mockRejectedValue(new AuthError('bad'));
  });

  it('lets 8 attempts through to auth, then throttles the 9th without calling signIn', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await signInWithPassword(null, fd(EMAIL, 'wrong'));
      expect(r.error).toBe('Invalid email or password.');
    }
    expect(signIn).toHaveBeenCalledTimes(8);

    const throttled = await signInWithPassword(null, fd(EMAIL, 'wrong'));
    expect(throttled.error).toMatch(/too many sign-in attempts/i);
    expect(signIn).toHaveBeenCalledTimes(8); // not called again — throttled before auth
  });
});
