/**
 * Session + row-ownership + audit helpers (Phase 4 security pass).
 * Use these EVERYWHERE — every server action and route handler re-verifies
 * the session, scopes queries by userId, and audit-logs sensitive actions.
 */
import type { Prisma } from '@/generated/prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  householdRepairAction,
  type HouseholdRole,
} from '@/lib/engine/household/membership';

export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new Error('Unauthorized');
  return id;
}

export type Viewer = {
  userId: string;
  household: null | {
    id: string;
    name: string;
    /** The VIEWER's role, post-repair. */
    role: HouseholdRole;
    memberIds: string[];
  };
};

/**
 * Resolves the session to viewer identity + household context in one query
 * (HOUSEHOLD_ARCHITECTURE §4.3). Membership is evaluated per request against
 * the DB, so removal/leave takes effect on the next query with no JWT work.
 *
 * SELF-HEAL (§4.1 lazy repair, T11): if the resolved household has members but
 * no owner (the owner left, was deleted, or a crash interrupted bookkeeping),
 * the deterministic promotion target (earliest joinedAt, tie-break lowest
 * userId — pure `householdRepairAction`) is promoted idempotently here, at
 * read. Concurrent readers compute the SAME target, so the updateMany
 * converges. A zero-member household is unreachable through this path (the
 * viewer IS a member) and is reaped opportunistically by the household actions.
 */
export async function requireViewer(): Promise<Viewer> {
  const userId = await requireUserId();
  const membership = await prisma.householdMember.findUnique({
    where: { userId },
    select: {
      household: {
        select: {
          id: true,
          name: true,
          members: { select: { userId: true, role: true, joinedAt: true } },
        },
      },
    },
  });
  if (!membership) return { userId, household: null };

  let members = membership.household.members;
  const repair = householdRepairAction(members);
  if (repair.kind === 'promote') {
    await prisma.householdMember.updateMany({
      where: { householdId: membership.household.id, userId: repair.userId },
      data: { role: 'owner' },
    });
    members = members.map((m) =>
      m.userId === repair.userId ? { ...m, role: 'owner' } : m,
    );
  }

  const mine = members.find((m) => m.userId === userId);
  // Guaranteed present (members came from the same query snapshot as the
  // viewer's own membership row) — the guard exists for type narrowing and
  // fails CLOSED to "no household" if that invariant is ever broken.
  if (!mine) return { userId, household: null };

  return {
    userId,
    household: {
      id: membership.household.id,
      name: membership.household.name,
      role: mine.role as HouseholdRole,
      memberIds: members.map((m) => m.userId),
    },
  };
}

/** The viewer's household partners (member ids minus self). Empty without a household. */
export function partnerIdsOf(viewer: Viewer): string[] {
  if (!viewer.household) return [];
  return viewer.household.memberIds.filter((id) => id !== viewer.userId);
}

/**
 * The partner-shared slice of the visible set (TASKS 4.2 slice 2 —
 * HOUSEHOLD_ARCHITECTURE §4.3): accounts a LIVE household partner has flagged
 * `sharedToHousehold`. Returns null when the viewer has no partners, so callers
 * can skip the query entirely — a `userId: { in: [] }` where matches nothing,
 * but null makes the degenerate case explicit and unqueryable by accident.
 *
 * Liveness is inherited from `requireViewer()`: `memberIds` is resolved from
 * the DB per request, so a departed partner (T2/T4) drops out of this predicate
 * on the next read even if their share flags were somehow left set.
 */
export function partnerSharedAccountsWhere(viewer: Viewer): Prisma.AccountWhereInput | null {
  const partnerIds = partnerIdsOf(viewer);
  if (partnerIds.length === 0) return null;
  return { sharedToHousehold: true, userId: { in: partnerIds } };
}

/**
 * THE single widened read scope (§4.3 rule 2) — hand-rolled OR clauses in
 * fetchers are a review-rejectable defect; compose this instead. With no
 * household, or a household with no partners, it MUST degenerate to exactly
 * `{ userId }` (T6 — unit-locked by deep equality, not just equivalent
 * semantics), so every existing surface that adopts it stays byte-identical
 * for solo users and the demo user.
 */
export function visibleAccountsWhere(viewer: Viewer): Prisma.AccountWhereInput {
  const shared = partnerSharedAccountsWhere(viewer);
  if (!shared) return { userId: viewer.userId };
  return { OR: [{ userId: viewer.userId }, shared] };
}

export async function auditLog(userId: string, action: string, meta: Record<string, unknown> = {}) {
  await prisma.auditLog.create({
    data: { userId, action, meta: JSON.stringify(meta) },
  });
}

/**
 * Minimal in-memory rate limiter (per key, fixed window). Per-INSTANCE only (a
 * no-op across serverless invocations). NO production caller remains — every
 * request path now uses `rateLimitDurable` (DB-backed, holds across instances).
 * Retained only to satisfy the critic5-surface regression that pins fixed-window
 * semantics; keep the function and its test.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/**
 * Durable, multi-instance rate limiter (ROADMAP #8). A fixed-window counter
 * persisted in the RateLimit table, so a limit holds across serverless instances
 * (unlike `rateLimit` above). Returns true when the request is ALLOWED.
 *
 * Atomicity (Hostile Critic CONC-1/SEC-1): the decision ALWAYS reads the count
 * produced by an atomic increment-or-create (upsert), never a hardcoded allow. So
 * a concurrent burst of N first-hits on a fresh key resolves to counts 1..N and
 * only the first `limit` pass — the earlier read-then-set-count-to-1 design let
 * EVERY concurrent first-hit bypass, defeating the throttle. The only residual
 * looseness is a handful of extra allows if many requests straddle the exact
 * window expiry (the conditional reset can drop a sibling's increment); that is
 * bounded by in-flight concurrency, acceptable for throttling. Timing uses
 * wall-clock `Date` (infra, not business-date logic — those stay in dates.ts).
 */
export async function rateLimitDurable(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  // Atomically reset ONLY an expired window (no-op if still open or absent).
  await prisma.rateLimit.updateMany({
    where: { key, resetAt: { lte: now } },
    data: { count: 0, resetAt },
  });

  // Atomic increment-or-create; the returned row carries the authoritative count.
  const row = await prisma.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, resetAt },
    update: { count: { increment: 1 } },
  });

  await maybePruneExpired(now.getTime());
  return row.count <= limit;
}

/** Delete rate-limit rows whose window expired before `before` (default: now). */
export async function pruneExpiredRateLimits(before: Date = new Date()): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: before } } });
  return count;
}

// Bound the RateLimit table WITHOUT depending on a scheduled cron: prune expired
// rows at most once per minute per instance (index-backed on resetAt). The
// signin:<email> key space is attacker-controlled, so unbounded growth would be a
// storage-exhaustion vector (Hostile Critic OPS-1). Best-effort — never lets a
// cleanup failure affect the limit decision.
let lastPruneAtMs = 0;
async function maybePruneExpired(nowMs: number): Promise<void> {
  if (nowMs - lastPruneAtMs < 60_000) return;
  lastPruneAtMs = nowMs;
  try {
    await pruneExpiredRateLimits(new Date(nowMs));
  } catch {
    // best-effort cleanup
  }
}
