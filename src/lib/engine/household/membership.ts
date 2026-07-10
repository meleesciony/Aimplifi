/**
 * Household membership engine (TASKS 4.2 slice 1 — HOUSEHOLD_ARCHITECTURE.md
 * §4.1/§4.3/§5.1). Pure, deterministic decisions only: no Prisma, no clock
 * reads, no randomness — `now` and code bytes are always inputs. The server
 * actions and `requireViewer` self-heal consume these; every T-invariant test
 * for the state machine (T7, T11, T12) locks a function here.
 *
 * Trust model (§4.3 rule 5): invite acceptance requires TWO factors — the
 * one-time code (hashed at rest, attempt-capped) AND a DB-row email match.
 * Deliberately NOT trusted: the signup allowlist and session email claims.
 */
import { createHash, timingSafeEqual } from 'crypto';

export type HouseholdRole = 'owner' | 'partner';

/** Stored invite statuses. 'expired' is never stored — it is computed at read. */
export type StoredInviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';
export type EffectiveInviteStatus = StoredInviteStatus | 'expired';

/** Invite lifetime (§4.3: "expiry ~14 days"). */
export const INVITE_TTL_DAYS = 14;
/** Failed-redemption hard cap — reaching it revokes the invite (§4.3, T12). */
export const INVITE_MAX_ATTEMPTS = 5;
/** Display-name bounds for a household. */
export const HOUSEHOLD_NAME_MAX = 60;

/**
 * Code alphabet: Crockford-style base32 without ambiguous glyphs (0/O, 1/I/L).
 * 8 chars over 31 glyphs ≈ 39.6 bits (log2(31)×8, slightly less after the
 * byte-mod-31 bias) — far beyond the 5-attempt cap + durable rate limit it is
 * defended by, and only the addressed email ever reaches the code check.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 chars, unambiguous
export const INVITE_CODE_LENGTH = 8;

/**
 * Deterministically format one code character per input byte (modulo bias over
 * a 31-char alphabet is irrelevant here — this is an invite code, not a key).
 * Randomness stays at the caller (crypto.randomBytes); this stays pure.
 */
export function codeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < INVITE_CODE_LENGTH) {
    throw new Error(`codeFromBytes needs at least ${INVITE_CODE_LENGTH} bytes`);
  }
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) out += '-'; // XXXX-XXXX for human handoff
  }
  return out;
}

/** Human-tolerant: case-insensitive, ignores spaces/dashes, maps 0→O-family ambiguity away is NOT attempted — the alphabet never issues those glyphs. */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

/** One-way at-rest hash of an invite code (hashUserRef idiom — sha256(salt:normalized)). */
export function hashInviteCode(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${normalizeInviteCode(code)}`).digest('hex');
}

/** Constant-time comparison of a candidate code against the stored hash. */
export function inviteCodeMatches(candidate: string, codeHash: string, salt: string): boolean {
  const a = Buffer.from(hashInviteCode(candidate, salt), 'hex');
  const b = Buffer.from(codeHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Lazy expiry (§4.2): a stored 'pending' whose expiresAt is in the past reads
 * as 'expired'; every other stored status is final and expiry never rewrites it.
 * Boundary: at exactly `expiresAt` the invite is still live (doc: expiresAt < now).
 */
export function inviteEffectiveStatus(
  invite: { status: string; expiresAt: Date },
  now: Date,
): EffectiveInviteStatus {
  if (invite.status === 'pending' && invite.expiresAt.getTime() < now.getTime()) {
    return 'expired';
  }
  return invite.status as EffectiveInviteStatus;
}

export type RedemptionDenial =
  | 'not_pending' // accepted/declined/revoked — final
  | 'expired'
  | 'attempts_exceeded'
  | 'email_mismatch'
  | 'already_member' // ONLY reachable by the addressed email — safe to say aloud
  | 'code_mismatch'; // the only denial that counts as a failed attempt

export type RedemptionVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: RedemptionDenial;
      /** true ⇒ the caller increments `attempts` (and revokes at the cap). */
      countsAsAttempt: boolean;
    };

/**
 * The redemption gate (T7, T12). Check order is deliberate and is itself a
 * security property (critic #210 F2): invite liveness first (dead invites are
 * inert), then the EMAIL factor, and only past the email match anything about
 * the accepter's own state ('already_member') — so a third party probing
 * invite ids learns nothing but the one generic failure, exactly the §4.6
 * enumeration claim ("invite id + session email match" before any disclosure).
 * Only a CODE mismatch burns an attempt: the code is the sole brute-forceable
 * factor (email is bound to the signed-in DB row — retries can't vary it), and
 * counting email mismatches would let any authenticated stranger burn a
 * victim's invite to revocation. Email comparison uses the DB-row email — the
 * CALLER must pass `accepterEmail` from `prisma.user.findUnique`, never from
 * session claims (§4.3 F4/F6). Both sides are normalized here again so the
 * gate cannot be weakened by an un-normalized legacy row.
 */
export function evaluateInviteRedemption(args: {
  invite: { status: string; expiresAt: Date; attempts: number; email: string; codeHash: string };
  accepterEmail: string;
  accepterHasMembership: boolean;
  candidateCode: string;
  codeSalt: string;
  now: Date;
}): RedemptionVerdict {
  const { invite } = args;
  const effective = inviteEffectiveStatus(invite, args.now);
  if (effective === 'expired') return { ok: false, reason: 'expired', countsAsAttempt: false };
  if (effective !== 'pending') return { ok: false, reason: 'not_pending', countsAsAttempt: false };
  if (invite.attempts >= INVITE_MAX_ATTEMPTS) {
    return { ok: false, reason: 'attempts_exceeded', countsAsAttempt: false };
  }
  if (normalizeEmailForInvite(args.accepterEmail) !== normalizeEmailForInvite(invite.email)) {
    return { ok: false, reason: 'email_mismatch', countsAsAttempt: false };
  }
  if (args.accepterHasMembership) {
    return { ok: false, reason: 'already_member', countsAsAttempt: false };
  }
  if (!inviteCodeMatches(args.candidateCode, invite.codeHash, args.codeSalt)) {
    return { ok: false, reason: 'code_mismatch', countsAsAttempt: true };
  }
  return { ok: true };
}

/** Same semantics as lib/auth/validate's normalizeEmail — duplicated one-liner keeps the engine dependency-free. */
export function normalizeEmailForInvite(email: string): string {
  return email.trim().toLowerCase();
}

export type RepairAction =
  | { kind: 'none' }
  | { kind: 'reap' } // zero members — unreachable via membership, delete opportunistically
  | { kind: 'promote'; userId: string }; // ownerless — promote exactly one member

/**
 * Lazy-repair decision (§4.1, T11): deterministic and idempotent. An ownerless
 * household promotes the member with the earliest joinedAt (tie-break: lowest
 * userId), so every concurrent reader computes the SAME target and the repair
 * write (updateMany to role 'owner') converges. A memberless household reaps.
 */
export function householdRepairAction(
  members: ReadonlyArray<{ userId: string; role: string; joinedAt: Date }>,
): RepairAction {
  if (members.length === 0) return { kind: 'reap' };
  if (members.some((m) => m.role === 'owner')) return { kind: 'none' };
  let pick = members[0];
  for (const m of members.slice(1)) {
    const dt = m.joinedAt.getTime() - pick.joinedAt.getTime();
    if (dt < 0 || (dt === 0 && m.userId < pick.userId)) pick = m;
  }
  return { kind: 'promote', userId: pick.userId };
}

// ---------------------------------------------------------------------------
// Role rules (§4.3 rule 4). Trivial on purpose — pinned so the rules are code,
// not convention, and a future role (e.g. read-only child) changes ONE place.
// ---------------------------------------------------------------------------

/** v1: both roles may invite (cheap to restrict later). */
export function canInvite(role: HouseholdRole): boolean {
  return role === 'owner' || role === 'partner';
}

/** Owner only. */
export function canRevokeInvite(role: HouseholdRole): boolean {
  return role === 'owner';
}

/** Owner only, never on self (self uses leave). */
export function canRemoveMember(
  actorRole: HouseholdRole,
  actorUserId: string,
  targetUserId: string,
): boolean {
  return actorRole === 'owner' && actorUserId !== targetUserId;
}

/** Household display-name validation: trimmed, non-empty, bounded. */
export function validateHouseholdName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: 'Give your household a name.' };
  if (name.length > HOUSEHOLD_NAME_MAX) {
    return { ok: false, error: `Keep the name under ${HOUSEHOLD_NAME_MAX} characters.` };
  }
  return { ok: true, name };
}
