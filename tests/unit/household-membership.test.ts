/**
 * Household membership engine — pure state-machine units (TASKS 4.2 slice 1).
 * Locks the T-invariant decisions: lazy expiry + redemption gate (T7, T12) and
 * the deterministic lazy-repair promotion/reap (T11), plus the role rules.
 */
import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_LENGTH,
  INVITE_MAX_ATTEMPTS,
  canInvite,
  canRemoveMember,
  canRevokeInvite,
  codeFromBytes,
  evaluateInviteRedemption,
  hashInviteCode,
  householdRepairAction,
  inviteCodeMatches,
  inviteEffectiveStatus,
  normalizeInviteCode,
  validateHouseholdName,
} from '@/lib/engine/household/membership';

const T0 = new Date('2026-07-10T12:00:00Z');
const before = (ms: number) => new Date(T0.getTime() - ms);
const after = (ms: number) => new Date(T0.getTime() + ms);

describe('codeFromBytes / normalizeInviteCode', () => {
  it('is deterministic, XXXX-XXXX shaped, and never issues ambiguous glyphs', () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const code = codeFromBytes(bytes);
    expect(codeFromBytes(bytes)).toBe(code); // deterministic
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(code).not.toMatch(/[01OIL]/);
    expect(normalizeInviteCode(code)).toHaveLength(INVITE_CODE_LENGTH);
  });
  it('throws on too few bytes rather than issuing a short code', () => {
    expect(() => codeFromBytes(Uint8Array.from([1, 2, 3]))).toThrow(/bytes/);
  });
  it('normalization is case/dash/space tolerant', () => {
    expect(normalizeInviteCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeInviteCode('AB CD 23 45')).toBe('ABCD2345');
  });
});

describe('hashInviteCode / inviteCodeMatches', () => {
  it('matches an independently computed sha256(salt:normalized) vector', () => {
    // node: createHash('sha256').update('test-salt:ABCD2345').digest('hex')
    expect(hashInviteCode('abcd-2345', 'test-salt')).toBe(
      '6c18bf3078d56973fff1cb0b58961ebef0510b7409219d7119012d5566844ebb',
    );
  });
  it('verifies the right code in any formatting, rejects a wrong code or salt', () => {
    const hash = hashInviteCode('WXYZ-2345', 'salt-a');
    expect(inviteCodeMatches('wxyz2345', hash, 'salt-a')).toBe(true);
    expect(inviteCodeMatches(' WXYZ-2345 ', hash, 'salt-a')).toBe(true);
    expect(inviteCodeMatches('WXYZ-2346', hash, 'salt-a')).toBe(false);
    expect(inviteCodeMatches('WXYZ-2345', hash, 'salt-b')).toBe(false);
    expect(inviteCodeMatches('WXYZ-2345', 'not-hex-garbage', 'salt-a')).toBe(false);
  });
});

describe('inviteEffectiveStatus — lazy expiry (T7)', () => {
  it('pending + future expiry reads pending; pending + past reads expired', () => {
    expect(inviteEffectiveStatus({ status: 'pending', expiresAt: after(1) }, T0)).toBe('pending');
    expect(inviteEffectiveStatus({ status: 'pending', expiresAt: before(1) }, T0)).toBe('expired');
  });
  it('boundary: at exactly expiresAt the invite is still live (doc: expiresAt < now)', () => {
    expect(inviteEffectiveStatus({ status: 'pending', expiresAt: T0 }, T0)).toBe('pending');
  });
  it('final stored statuses are never rewritten by expiry', () => {
    for (const status of ['accepted', 'declined', 'revoked'] as const) {
      expect(inviteEffectiveStatus({ status, expiresAt: before(1) }, T0)).toBe(status);
    }
  });
});

describe('evaluateInviteRedemption — the two-factor gate (T7, T12)', () => {
  const SALT = 'gate-salt';
  const CODE = 'MNPQ-2345';
  const base = {
    status: 'pending',
    expiresAt: after(60_000),
    attempts: 0,
    email: 'partner@test.local',
    codeHash: hashInviteCode(CODE, SALT),
  };
  const redeem = (over: Partial<Parameters<typeof evaluateInviteRedemption>[0]> = {}, inviteOver = {}) =>
    evaluateInviteRedemption({
      invite: { ...base, ...inviteOver },
      accepterEmail: 'partner@test.local',
      accepterHasMembership: false,
      candidateCode: CODE,
      codeSalt: SALT,
      now: T0,
      ...over,
    });

  it('succeeds only with BOTH factors: right email AND right code', () => {
    expect(redeem()).toEqual({ ok: true });
  });
  it('right email + wrong/missing code ALWAYS fails and burns an attempt (T12)', () => {
    expect(redeem({ candidateCode: 'MNPQ-2346' })).toEqual({
      ok: false,
      reason: 'code_mismatch',
      countsAsAttempt: true,
    });
    expect(redeem({ candidateCode: '' })).toMatchObject({ ok: false, reason: 'code_mismatch' });
  });
  it('right code + wrong email fails WITHOUT burning an attempt — a stranger can neither join nor revoke-by-probing (critic #210 F2)', () => {
    expect(redeem({ accepterEmail: 'attacker@test.local' })).toEqual({
      ok: false,
      reason: 'email_mismatch',
      countsAsAttempt: false,
    });
  });
  it('the email factor is checked BEFORE accepter state: a mismatched email never learns already_member (enumeration order, critic #210 F2)', () => {
    expect(
      redeem({ accepterEmail: 'attacker@test.local', accepterHasMembership: true }),
    ).toEqual({ ok: false, reason: 'email_mismatch', countsAsAttempt: false });
  });
  it('email match is normalized on both sides (legacy un-normalized rows cannot weaken the gate)', () => {
    expect(redeem({ accepterEmail: '  Partner@Test.LOCAL ' })).toEqual({ ok: true });
    expect(redeem({}, { email: ' PARTNER@test.local ' })).toEqual({ ok: true });
  });
  it('expired / non-pending invites are inert and burn no attempts', () => {
    expect(redeem({}, { expiresAt: before(1) })).toEqual({
      ok: false,
      reason: 'expired',
      countsAsAttempt: false,
    });
    for (const status of ['accepted', 'declined', 'revoked']) {
      expect(redeem({}, { status })).toEqual({
        ok: false,
        reason: 'not_pending',
        countsAsAttempt: false,
      });
    }
  });
  it('the attempts cap denies even a CORRECT code (hard cap, T12)', () => {
    expect(redeem({}, { attempts: INVITE_MAX_ATTEMPTS })).toEqual({
      ok: false,
      reason: 'attempts_exceeded',
      countsAsAttempt: false,
    });
  });
  it('the ADDRESSED accepter who already has a membership is told so (only denial reachable past the email factor besides code)', () => {
    expect(redeem({ accepterHasMembership: true })).toEqual({
      ok: false,
      reason: 'already_member',
      countsAsAttempt: false,
    });
  });
});

describe('householdRepairAction — deterministic lazy repair (T11)', () => {
  const m = (userId: string, role: string, joinedAt: string) => ({
    userId,
    role,
    joinedAt: new Date(joinedAt),
  });

  it('zero members ⇒ reap; an owner present ⇒ no repair', () => {
    expect(householdRepairAction([])).toEqual({ kind: 'reap' });
    expect(
      householdRepairAction([m('u1', 'owner', '2026-01-01'), m('u2', 'partner', '2026-01-02')]),
    ).toEqual({ kind: 'none' });
  });
  it('ownerless ⇒ promotes exactly the earliest-joined member', () => {
    expect(
      householdRepairAction([m('u2', 'partner', '2026-01-02'), m('u1', 'partner', '2026-01-03')]),
    ).toEqual({ kind: 'promote', userId: 'u2' });
  });
  it('joinedAt tie ⇒ lowest userId wins, regardless of input order', () => {
    const a = m('ua', 'partner', '2026-01-02');
    const b = m('ub', 'partner', '2026-01-02');
    expect(householdRepairAction([b, a])).toEqual({ kind: 'promote', userId: 'ua' });
    expect(householdRepairAction([a, b])).toEqual({ kind: 'promote', userId: 'ua' });
  });
  it('is idempotent: applying the promotion yields a state that needs no repair', () => {
    const members = [m('u2', 'partner', '2026-01-02'), m('u1', 'partner', '2026-01-03')];
    const action = householdRepairAction(members);
    expect(action.kind).toBe('promote');
    const repaired = members.map((x) =>
      x.userId === (action as { userId: string }).userId ? { ...x, role: 'owner' } : x,
    );
    expect(householdRepairAction(repaired)).toEqual({ kind: 'none' });
  });
  it('a sole member household ownerless (post-deletion survivor) promotes that member', () => {
    expect(householdRepairAction([m('u9', 'partner', '2026-02-01')])).toEqual({
      kind: 'promote',
      userId: 'u9',
    });
  });
});

describe('role rules (§4.3 rule 4)', () => {
  it('both roles may invite in v1; only the owner revokes invites', () => {
    expect(canInvite('owner')).toBe(true);
    expect(canInvite('partner')).toBe(true);
    expect(canRevokeInvite('owner')).toBe(true);
    expect(canRevokeInvite('partner')).toBe(false);
  });
  it('removeMember: owner only, never on self', () => {
    expect(canRemoveMember('owner', 'u1', 'u2')).toBe(true);
    expect(canRemoveMember('owner', 'u1', 'u1')).toBe(false); // self uses leave
    expect(canRemoveMember('partner', 'u2', 'u1')).toBe(false);
  });
});

describe('validateHouseholdName', () => {
  it('trims, rejects empty/whitespace, bounds length', () => {
    expect(validateHouseholdName('  Our household  ')).toEqual({ ok: true, name: 'Our household' });
    expect(validateHouseholdName('   ')).toMatchObject({ ok: false });
    expect(validateHouseholdName('x'.repeat(61))).toMatchObject({ ok: false });
    expect(validateHouseholdName('x'.repeat(60))).toMatchObject({ ok: true });
  });
});
