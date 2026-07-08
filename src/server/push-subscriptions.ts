/**
 * Persistence for Web-Push subscriptions (Gap 2 §2). Thin, ownership-scoped
 * wrappers over Prisma — the route handlers call these after verifying the session
 * (requireUserId / auth()). The endpoint is @unique, so re-subscribing the same
 * browser upserts (and reassigns to the current user if a shared device switches
 * accounts) rather than duplicating.
 */
import { prisma } from '@/lib/db';
import type { PushEndpoint } from '@/lib/push';

/**
 * Max subscriptions kept per user. A person uses a handful of browsers; a much
 * larger number is abuse (critic P2-2: unbounded subs could starve the serial notify
 * sweep). On overflow we evict the OLDEST, so a real user's newest devices survive.
 */
const MAX_SUBSCRIPTIONS_PER_USER = 20;

/** Store (or refresh) a browser subscription for a user. Idempotent per endpoint. */
export async function savePushSubscription(userId: string, sub: PushEndpoint): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
    // A shared device that switches accounts reassigns the endpoint to the new user.
    update: { userId, p256dh: sub.p256dh, auth: sub.auth },
  });

  // Bound the per-user set: drop the oldest beyond the cap (keeps the newest N).
  const count = await prisma.pushSubscription.count({ where: { userId } });
  if (count > MAX_SUBSCRIPTIONS_PER_USER) {
    const stale = await prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: count - MAX_SUBSCRIPTIONS_PER_USER,
      select: { id: true },
    });
    await prisma.pushSubscription.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}

/** Remove a subscription the user explicitly turned off (scoped to that user). */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/**
 * Prune a subscription the push service reported gone (404/410). Keyed on the
 * unique endpoint only — a dead endpoint is dead regardless of owner.
 */
export async function deleteGoneEndpoint(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}
