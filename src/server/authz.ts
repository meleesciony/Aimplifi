/**
 * Session + row-ownership + audit helpers (Phase 4 security pass).
 * Use these EVERYWHERE — every server action and route handler re-verifies
 * the session, scopes queries by userId, and audit-logs sensitive actions.
 */
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new Error('Unauthorized');
  return id;
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
