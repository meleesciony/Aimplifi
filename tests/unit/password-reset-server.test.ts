/**
 * Password-reset flow (#257) — pure engine cases plus the REAL guarded core
 * (mintResetToken / requestPasswordResetCore / performPasswordReset) against
 * throwaway users and the real Prisma client (account-delete-server.test.ts
 * pattern).
 *
 * The contract under test:
 *   1. Only the hash is at rest — the plaintext token appears nowhere in the DB.
 *   2. Enumeration-neutral: unknown email → ok:true, zero rows written.
 *   3. Demo fence in the CORE: the shared demo account can neither mint nor
 *      consume a token.
 *   4. Single-active: a new request invalidates the previous unused token.
 *   5. Happy path: new password verifies, old fails, ALL sessions revoked
 *      (sessionEpoch bumped) in the same transaction, token single-use.
 *   6. Expired / reused / unknown tokens refuse with one neutral message.
 *   7. Weak password refuses WITHOUT consuming the token.
 *   8. The single-use gate is an atomic claim — two racing confirms, one winner.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RESET_TOKEN_BYTES,
  hashResetToken,
  resetTokenFromBytes,
  resetTokenMatches,
  resetTokenState,
} from '@/lib/engine/auth/reset';
import {
  mintResetToken,
  performPasswordReset,
  requestPasswordResetCore,
  resetTokenSalt,
} from '@/server/password-reset';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { prisma } from '@/lib/db';

const NOW = new Date('2026-07-21T12:00:00Z');

describe('reset token engine (pure)', () => {
  it('renders 32 bytes as url-safe base64url and rejects short input', () => {
    const token = resetTokenFromBytes(new Uint8Array(RESET_TOKEN_BYTES).fill(7));
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe, no padding
    expect(token.length).toBe(43); // 32 bytes → ceil(32*4/3) unpadded
    expect(() => resetTokenFromBytes(new Uint8Array(8))).toThrow(/at least 32/);
  });

  it('hash matches only the exact token under the exact salt (constant-time path)', () => {
    const t = resetTokenFromBytes(new Uint8Array(RESET_TOKEN_BYTES).fill(9));
    const h = hashResetToken(t, 'salt-a');
    expect(resetTokenMatches(t, h, 'salt-a')).toBe(true);
    expect(resetTokenMatches(t, h, 'salt-b')).toBe(false);
    expect(resetTokenMatches(`${t}x`, h, 'salt-a')).toBe(false);
    expect(resetTokenMatches(t.toUpperCase(), h, 'salt-a')).toBe(false); // exact bytes, no folding
  });

  it('state: live at exactly expiresAt, expired 1ms past, used is terminal and beats expired', () => {
    const at = new Date('2026-07-21T12:30:00Z');
    expect(resetTokenState({ usedAt: null, expiresAt: at }, at)).toBe('live');
    expect(resetTokenState({ usedAt: null, expiresAt: at }, new Date(at.getTime() + 1))).toBe('expired');
    expect(resetTokenState({ usedAt: NOW, expiresAt: at }, new Date(at.getTime() + 1))).toBe('used');
  });
});

describe('password-reset core vs real Prisma (#257)', () => {
  const USER = `reset-${Date.now()}-${process.pid}`;
  const EMAIL = `${USER}@test.local`;
  const OLD_PASSWORD = 'old-password-123';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({
      data: { id: USER, email: EMAIL, passwordHash: hashPassword(OLD_PASSWORD) },
    });
  });
  afterAll(wipe);

  it('2. unknown email: ok + neutral disposition, ZERO rows written', async () => {
    const before = await prisma.passwordResetToken.count();
    const res = await requestPasswordResetCore(`nobody-${USER}@test.local`, NOW, 'https://x.test');
    expect(res.ok).toBe(true);
    expect(res.disposition).toBe('no-account');
    expect(res.userId).toBeUndefined();
    expect(await prisma.passwordResetToken.count()).toBe(before);
  });

  it('1+4. mint stores ONLY the hash; a second mint invalidates the first unused token', async () => {
    const t1 = await mintResetToken(USER, NOW);
    expect(t1).not.toBeNull();
    const rows1 = await prisma.passwordResetToken.findMany({ where: { userId: USER } });
    expect(rows1).toHaveLength(1);
    expect(rows1[0].tokenHash).toBe(hashResetToken(t1!, resetTokenSalt()));
    expect(rows1[0].tokenHash).not.toContain(t1!); // plaintext nowhere at rest
    expect(rows1[0].expiresAt.getTime()).toBe(NOW.getTime() + 30 * 60 * 1000);

    const t2 = await mintResetToken(USER, NOW);
    const rows2 = await prisma.passwordResetToken.findMany({ where: { userId: USER } });
    expect(rows2).toHaveLength(1); // single-active
    expect(rows2[0].tokenHash).toBe(hashResetToken(t2!, resetTokenSalt()));
    // the first token is now dead
    const stale = await performPasswordReset(t1!, 'new-password-456', NOW);
    expect(stale.ok).toBe(false);
    expect(stale.state).toBe('bad-token');
  });

  it('3. demo fence in the core: no mint, no consume', async () => {
    expect(await mintResetToken(DEMO_USER_ID, NOW)).toBeNull();
    expect(await prisma.passwordResetToken.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    const req = await requestPasswordResetCore('demo@aimplifi.app', NOW, 'https://x.test');
    // whatever email the demo row carries, the request path can only answer
    // neutrally; assert directly against the seeded row's real email too:
    const demo = await prisma.user.findUnique({ where: { id: DEMO_USER_ID }, select: { email: true } });
    if (demo) {
      const reqSeeded = await requestPasswordResetCore(demo.email, NOW, 'https://x.test');
      expect(reqSeeded.ok).toBe(true);
      expect(reqSeeded.disposition).toBe('demo');
    }
    expect(req.ok).toBe(true);
    expect(await prisma.passwordResetToken.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    // forged row (hostile write) still refuses at consume time
    const forged = resetTokenFromBytes(new Uint8Array(RESET_TOKEN_BYTES).fill(3));
    if (demo) {
      await prisma.passwordResetToken.create({
        data: {
          userId: DEMO_USER_ID,
          tokenHash: hashResetToken(forged, resetTokenSalt()),
          expiresAt: new Date(NOW.getTime() + 60_000),
        },
      });
      const res = await performPasswordReset(forged, 'new-password-456', NOW);
      expect(res.ok).toBe(false);
      expect(res.state).toBe('demo');
      await prisma.passwordResetToken.deleteMany({ where: { userId: DEMO_USER_ID } });
    }
  });

  it('7. weak password refuses WITHOUT consuming the token', async () => {
    const t = await mintResetToken(USER, NOW);
    const res = await performPasswordReset(t!, 'short', NOW);
    expect(res.ok).toBe(false);
    expect(res.state).toBe('weak-password');
    const row = await prisma.passwordResetToken.findFirst({ where: { userId: USER } });
    expect(row!.usedAt).toBeNull(); // still live
  });

  it('5+6. happy path: password rotates, sessions revoke, token is single-use', async () => {
    const before = await prisma.user.findUnique({ where: { id: USER }, select: { sessionEpoch: true } });
    const t = await mintResetToken(USER, NOW);
    const res = await performPasswordReset(t!, 'brand-new-pass-789', NOW);
    expect(res.ok).toBe(true);
    expect(res.state).toBe('reset');
    expect(res.userId).toBe(USER);

    const user = await prisma.user.findUnique({ where: { id: USER } });
    expect(verifyPassword('brand-new-pass-789', user!.passwordHash)).toBe(true);
    expect(verifyPassword(OLD_PASSWORD, user!.passwordHash)).toBe(false);
    expect(user!.sessionEpoch).toBe(before!.sessionEpoch + 1); // every session revoked

    // consumed row survives as audit trail, but the token is dead
    const row = await prisma.passwordResetToken.findFirst({ where: { userId: USER } });
    expect(row!.usedAt).not.toBeNull();
    const again = await performPasswordReset(t!, 'another-pass-000', NOW);
    expect(again.ok).toBe(false);
    expect(again.state).toBe('used');
    expect(again.error).toMatch(/invalid, already used, or expired/);
  });

  it('6b. expired token refuses with the same neutral message', async () => {
    const t = await mintResetToken(USER, NOW);
    await prisma.passwordResetToken.updateMany({
      where: { userId: USER, usedAt: null },
      data: { expiresAt: new Date(NOW.getTime() - 1) },
    });
    const res = await performPasswordReset(t!, 'valid-length-pass', NOW);
    expect(res.ok).toBe(false);
    expect(res.state).toBe('expired');
    expect(res.error).toMatch(/invalid, already used, or expired/);
  });

  it('8. atomic claim: two racing confirms, exactly one winner', async () => {
    const t = await mintResetToken(USER, NOW);
    const [a, b] = await Promise.all([
      performPasswordReset(t!, 'race-password-aaa', NOW),
      performPasswordReset(t!, 'race-password-bbb', NOW),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    const user = await prisma.user.findUnique({ where: { id: USER } });
    const winner = oks[0] === a ? 'race-password-aaa' : 'race-password-bbb';
    expect(verifyPassword(winner, user!.passwordHash)).toBe(true);
  });

  it('request core end-to-end: known email mints exactly one live token (email dormant → send-failed)', async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: USER } });
    const res = await requestPasswordResetCore(EMAIL.toUpperCase(), NOW, 'https://x.test/'); // normalization + trailing slash
    expect(res.ok).toBe(true);
    expect(res.userId).toBe(USER);
    // No RESEND_API_KEY in the test env — the provider is dormant by design.
    expect(res.disposition).toBe('send-failed');
    expect(await prisma.passwordResetToken.count({ where: { userId: USER, usedAt: null } })).toBe(1);
  });

  it('fail-closed origin (critic P2-2): null baseUrl mints NOTHING and sends nothing, still neutral', async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: USER } });
    const res = await requestPasswordResetCore(EMAIL, NOW, null);
    expect(res.ok).toBe(true); // outwardly identical
    expect(res.disposition).toBe('no-origin'); // operator-facing truth
    // no token minted for a link that could never be safely delivered
    expect(await prisma.passwordResetToken.count({ where: { userId: USER } })).toBe(0);
  });

  it('Google-only user (passwordHash null) can reset — recorded policy: mailbox owns the account', async () => {
    const GUSER = `${USER}-google`;
    await prisma.user.create({ data: { id: GUSER, email: `${GUSER}@test.local`, passwordHash: null } });
    try {
      const t = await mintResetToken(GUSER, NOW);
      const res = await performPasswordReset(t!, 'first-password-123', NOW);
      expect(res.ok).toBe(true);
      const u = await prisma.user.findUnique({ where: { id: GUSER } });
      expect(verifyPassword('first-password-123', u!.passwordHash)).toBe(true);
    } finally {
      await prisma.user.deleteMany({ where: { id: GUSER } });
    }
  });
});
