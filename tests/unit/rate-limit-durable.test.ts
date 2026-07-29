/**
 * Durable rate limiter + sign-in throttle (ROADMAP #8). The DB-backed limiter
 * holds across instances (the in-memory one is a per-instance no-op on
 * serverless), and the sign-in action throttles repeated attempts per account.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
// next-auth's index pulls `next/server`, which vitest's node resolver can't load
// (fine in the Next build). We only need AuthError to exist for the import.
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));
// clientIp dynamically imports next/headers — mock it so we control the per-IP key.
vi.mock('next/headers', () => ({ headers: vi.fn() }));

import { AuthError } from 'next-auth';
import { headers } from 'next/headers';
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

describe('signInWithPassword throttle — IP cap + no lockout (ROADMAP #8, Critic SEC-2)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const keys: string[] = [];
  function fd(email: string, password: string) {
    const f = new FormData();
    f.set('email', email);
    f.set('password', password);
    return f;
  }
  function mockIp(ip: string) {
    vi.mocked(headers).mockResolvedValue({ get: (k: string) => (k === 'x-forwarded-for' ? ip : null) } as never);
  }
  afterEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { in: keys } } });
  });

  it('counts only FAILED attempts per account; the 9th failure is throttled', async () => {
    const email = `fail-${stamp}@test.local`;
    const ip = `10.0.0.${(process.pid % 200) + 1}`;
    keys.push(`signin-fail:${email}`, `signin-ip:${ip}`);
    mockIp(ip);
    vi.mocked(signIn).mockRejectedValue(new AuthError('bad'));
    for (let i = 0; i < 8; i++) {
      expect((await signInWithPassword(null, fd(email, 'wrong'))).error).toBe('Invalid email or password.');
    }
    expect((await signInWithPassword(null, fd(email, 'wrong'))).error).toMatch(/too many failed attempts/i);
  });

  it('NEVER locks out a correct password — it succeeds even after the fail budget is spent', async () => {
    const email = `nolock-${stamp}@test.local`;
    const ip = `10.0.1.${(process.pid % 200) + 1}`;
    keys.push(`signin-fail:${email}`, `signin-ip:${ip}`);
    mockIp(ip);
    vi.mocked(signIn).mockRejectedValue(new AuthError('bad'));
    for (let i = 0; i < 8; i++) await signInWithPassword(null, fd(email, 'wrong')); // spend the fail budget
    // A correct password: signIn resolves (in prod it throws NEXT_REDIRECT) → no error,
    // and the per-account-fail check (catch-only) is never reached, so it's not blocked.
    vi.mocked(signIn).mockResolvedValue(undefined as never);
    expect((await signInWithPassword(null, fd(email, 'correct'))).error).toBeUndefined();
  });

  it('caps total attempts per device (IP) BEFORE any auth work', async () => {
    const ip = `10.0.2.${(process.pid % 200) + 1}`;
    keys.push(`signin-ip:${ip}`);
    mockIp(ip);
    // Pre-fill the per-IP window to its limit; the next attempt is blocked before signIn.
    await prisma.rateLimit.upsert({
      where: { key: `signin-ip:${ip}` },
      create: { key: `signin-ip:${ip}`, count: 20, resetAt: new Date(Date.now() + 60_000) },
      update: { count: 20, resetAt: new Date(Date.now() + 60_000) },
    });
    vi.mocked(signIn).mockRejectedValue(new AuthError('bad'));
    const blocked = await signInWithPassword(null, fd(`anyone-${stamp}@test.local`, 'x'));
    expect(blocked.error).toMatch(/too many sign-in attempts from this device/i);
    expect(signIn).not.toHaveBeenCalled();
  });
});

/**
 * A fault on OUR side may not be reported as a wrong password (owner report
 * 2026-07-29: sign-in "sometimes says wrong pw. I click it again, it works").
 *
 * Auth.js wraps anything thrown inside `authorize` — a failed user lookup, a
 * database blip — as `CallbackRouteError`, and every AuthError used to collapse
 * into "Invalid email or password.": a claim about what the reader typed, made
 * when the truth was that we broke. Two things must hold, and the SECOND is the
 * security half: a system fault must not spend the per-account failed-attempt
 * budget, while an UNRECOGNISED AuthError must still spend it, so nobody can
 * dodge brute-force throttling by provoking an unusual error.
 */
describe('sign-in errors: our fault vs a wrong password', () => {
  const stamp = `sys-${Date.now()}-${process.pid}`;
  const keys: string[] = [];
  function fd(email: string, password: string) {
    const f = new FormData();
    f.set('email', email);
    f.set('password', password);
    return f;
  }
  function mockIp(ip: string) {
    vi.mocked(headers).mockResolvedValue({ get: (k: string) => (k === 'x-forwarded-for' ? ip : null) } as never);
  }
  function typedAuthError(type: string) {
    return Object.assign(new AuthError('boom'), { type });
  }
  afterEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { in: keys } } });
  });

  it('a CallbackRouteError blames us, not the password, and spends no fail budget', async () => {
    const email = `${stamp}-sys@test.local`;
    const ip = `10.0.3.${(process.pid % 200) + 1}`;
    keys.push(`signin-fail:${email}`, `signin-ip:${ip}`);
    mockIp(ip);
    vi.mocked(signIn).mockRejectedValue(typedAuthError('CallbackRouteError'));

    const out = await signInWithPassword(null, fd(email, 'the-correct-password'));
    expect(out.error).toMatch(/problem on our side/i);
    expect(out.error).not.toMatch(/invalid email or password/i);
    // The reader failed nothing, so the account's throttle budget is untouched.
    expect(await prisma.rateLimit.findUnique({ where: { key: `signin-fail:${email}` } })).toBeNull();
  });

  it('an UNRECOGNISED AuthError still counts as a failed attempt (no throttle bypass)', async () => {
    const email = `${stamp}-unknown@test.local`;
    const ip = `10.0.4.${(process.pid % 200) + 1}`;
    keys.push(`signin-fail:${email}`, `signin-ip:${ip}`);
    mockIp(ip);
    vi.mocked(signIn).mockRejectedValue(typedAuthError('SomeFutureAuthError'));

    const out = await signInWithPassword(null, fd(email, 'wrong'));
    expect(out.error).toBe('Invalid email or password.');
    const row = await prisma.rateLimit.findUnique({ where: { key: `signin-fail:${email}` } });
    expect(row!.count).toBe(1);
  });
});
