/**
 * Email/password auth (DECISIONS #43) — real signUpWithPassword against throwaway
 * users, plus a data-isolation check (the whole point of multi-user auth: one
 * user can't see another's accounts). signIn is mocked so the action doesn't try
 * to redirect.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ signIn: vi.fn() }));
// next-auth's index pulls `next/server`, which vitest's node resolver can't load
// (fine in the Next build). We only need AuthError to exist for the import.
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));

import { signUpWithPassword } from '@/server/auth-actions';
import { getAccountsView } from '@/server/transactions';
import { verifyPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db';

const stamp = `${Date.now()}-${process.pid}`;
const email = `auth-${stamp}@test.local`;
const uA = `iso-a-${stamp}`;
const uB = `iso-b-${stamp}`;

function fd(em: string, pw: string) {
  const f = new FormData();
  f.set('email', em);
  f.set('password', pw);
  f.set('mode', 'signup');
  return f;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { OR: [{ email }, { id: { in: [uA, uB] } }] } });
});

describe('signUpWithPassword (real action, throwaway users)', () => {
  it('creates a user whose password verifies (and a wrong one does not)', async () => {
    const r = await signUpWithPassword(null, fd(email, 'supersecret1'));
    expect(r.error).toBeUndefined();
    const u = await prisma.user.findUnique({ where: { email } });
    expect(u?.passwordHash).toBeTruthy();
    expect(verifyPassword('supersecret1', u!.passwordHash)).toBe(true);
    expect(verifyPassword('wrongpassword', u!.passwordHash)).toBe(false);
  });

  it('rejects a duplicate email', async () => {
    const r = await signUpWithPassword(null, fd(email.toUpperCase(), 'supersecret1')); // normalized → same
    expect(r.error).toMatch(/already exists/i);
  });

  it('rejects invalid input (bad email + short password)', async () => {
    const r = await signUpWithPassword(null, fd('not-an-email', 'short'));
    expect(r.error).toBeTruthy();
    expect(await prisma.user.findUnique({ where: { email: 'not-an-email' } })).toBeNull();
  });
});

describe('data isolation between users', () => {
  it("getAccountsView returns only the caller's accounts", async () => {
    await prisma.user.create({ data: { id: uA, email: `${uA}@test.local` } });
    await prisma.user.create({ data: { id: uB, email: `${uB}@test.local` } });
    await prisma.account.create({ data: { userId: uA, provider: 'demo', name: 'A-Checking', type: 'CHECKING', currentBalanceCents: 100 } });
    await prisma.account.create({ data: { userId: uB, provider: 'demo', name: 'B-Checking', type: 'CHECKING', currentBalanceCents: 999 } });

    const viewA = await getAccountsView(uA);
    const names = [...viewA.assets.accounts, ...viewA.liabilities.accounts].map((a) => a.name);
    expect(names).toContain('A-Checking');
    expect(names).not.toContain('B-Checking');
    expect(viewA.netWorthCents).toBe(100); // only A's account
  });
});

describe('invite-only allowlist gates signup (DECISIONS #57)', () => {
  const allowed = `allow-${stamp}@invited.test`;
  const denied = `deny-${stamp}@stranger.test`;

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.user.deleteMany({ where: { email: { in: [allowed, denied] } } });
  });

  it('rejects an un-invited email (no user created) but lets a listed one through', async () => {
    vi.stubEnv('SIGNUP_ALLOWLIST', `${allowed}, @nobody.test`);

    const deny = await signUpWithPassword(null, fd(denied, 'supersecret1'));
    expect(deny.error).toMatch(/invite-only/i);
    expect(await prisma.user.findUnique({ where: { email: denied } })).toBeNull();

    const ok = await signUpWithPassword(null, fd(allowed, 'supersecret1'));
    expect(ok.error).toBeUndefined();
    expect(await prisma.user.findUnique({ where: { email: allowed } })).not.toBeNull();
  });
});
