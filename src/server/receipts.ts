/**
 * Value-receipts persistence (TASKS 1.3, DECISIONS #206). Thin, ownership-scoped I/O
 * around the pure engine/receipts module: record catch candidates append-only with
 * per-user key dedup, and read the cumulative summary back.
 *
 * Dedup follows the NotificationSent idiom exactly: filter against existing keys
 * first, then swallow ONLY a unique-constraint race (P2002 — a concurrent sweep
 * recorded the same catch, which is fine because it happened); any other DB fault
 * surfaces to the caller's failure handling.
 */
import { prisma } from '@/lib/db';
import {
  summarizeReceipts,
  type ReceiptCandidate,
  type ValueReceiptsSummary,
} from '@/lib/engine/receipts/receipts';

/**
 * Persist the not-yet-recorded candidates for this user. Idempotent per key —
 * re-recording the same catches is a no-op. Returns how many rows were inserted.
 */
export async function recordReceipts(
  userId: string,
  candidates: readonly ReceiptCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;
  const existing = await prisma.valueReceipt.findMany({
    where: { userId, key: { in: candidates.map((c) => c.key) } },
    select: { key: true },
  });
  const seen = new Set(existing.map((r) => r.key));
  let inserted = 0;
  for (const c of candidates) {
    if (seen.has(c.key)) continue;
    seen.add(c.key); // a duplicate key within one batch also mints once
    try {
      await prisma.valueReceipt.create({
        data: {
          userId,
          kind: c.kind,
          key: c.key,
          amountCents: c.amountCents,
          label: c.label,
          occurredOn: c.occurredOn,
        },
      });
      inserted += 1;
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e;
      // already recorded by a concurrent sweep — the catch happened, nothing lost
    }
  }
  return inserted;
}

/** The user's cumulative "what Aimplifi caught" tally (pure fold over their rows). */
export async function getValueReceiptsSummary(userId: string): Promise<ValueReceiptsSummary> {
  const rows = await prisma.valueReceipt.findMany({
    where: { userId },
    select: { kind: true, amountCents: true },
  });
  return summarizeReceipts(rows);
}
