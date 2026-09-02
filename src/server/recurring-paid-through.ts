/**
 * Store for "this cycle of a repeating bill is paid" (DECISIONS #584).
 *
 * Storage only, NextAuth-free so vitest can drive it. The `'use server'`
 * wrapper is `server/recurring-override-actions.ts`. Demo reads empty and
 * writes are refused — the shared demo cannot learn.
 */
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { OVERRIDE_BAD_MERCHANT, OVERRIDE_DEMO_BLOCKED } from '@/server/recurring-overrides';
import {
  type RecurringPaidThroughInput,
  NO_RECURRING_PAID_THROUGH,
} from '@/lib/engine/recurring/paid-through';

const MAX_MERCHANT_LEN = 200;
const MAX_READ = 200;

export async function getRecurringPaidThrough(
  userId: string,
): Promise<RecurringPaidThroughInput[]> {
  if (userId === DEMO_USER_ID) return [...NO_RECURRING_PAID_THROUGH];
  try {
    const rows = await prisma.recurringPaidThrough.findMany({
      where: { userId },
      select: { merchantCanonical: true, paidThrough: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_READ,
    });
    return rows.filter((r) => typeof r.paidThrough === 'string' && r.paidThrough.length === 10);
  } catch {
    return [...NO_RECURRING_PAID_THROUGH];
  }
}

export async function setRecurringPaidThrough(
  userId: string,
  merchantCanonical: string,
  paidThrough: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (userId === DEMO_USER_ID) return { ok: false, error: OVERRIDE_DEMO_BLOCKED };
  const key = merchantCanonical.trim();
  if (!key || key.length > MAX_MERCHANT_LEN) {
    return { ok: false, error: OVERRIDE_BAD_MERCHANT };
  }
  if (typeof paidThrough !== 'string' || paidThrough.length !== 10) {
    return { ok: false, error: "That repeating bill isn't on Recurring, so nothing changed." };
  }
  await prisma.recurringPaidThrough.upsert({
    where: { userId_merchantCanonical: { userId, merchantCanonical: key } },
    create: { userId, merchantCanonical: key, paidThrough },
    update: { paidThrough },
  });
  return { ok: true };
}
