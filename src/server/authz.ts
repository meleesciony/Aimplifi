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
 * Minimal in-memory rate limiter (per key, fixed window). Suitable for a
 * single-instance deployment; swap for Redis/Upstash when scaling out.
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
