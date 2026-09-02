'use server';

/**
 * The write path for the reader's bill verdicts (O.13f / O.15 slice 4) — auth,
 * audit, the projection refresh, and revalidation. The rules live in the engine
 * (`lib/engine/recurring/override.ts`) and the storage in
 * `server/recurring-overrides.ts`; this file is the boundary.
 *
 * Mutation-form recipe: `{ ok, error }`, never a throw for an expected refusal.
 *
 * THE REFRESH IS PART OF THE WRITE, not a nicety. Live detection is what /recurring,
 * the merchant lens, the radar and the coach read, but the CASH surfaces —
 * /calendar, /forecast, /spending-plan and the dashboard's cash-needed — read the
 * stored `ScheduledTransaction` rows, which only `refreshRecurringForUser` writes.
 * Without the refresh here, a reader who declared his rent a bill would see it on
 * /recurring and NOT on the calendar until some future sync: two surfaces
 * disagreeing about one fact, which is the defect class this app keeps finding.
 * When the refresh fails the save still stands (the instruction is stored and the
 * next sync applies it) and the caller is TOLD, rather than shown a success that
 * moved half the app.
 */
import { revalidatePath } from 'next/cache';
import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { auditLog, requireUserId } from '@/server/authz';
import { isDemoUser } from '@/lib/demo-user';
import {
  VERDICT_NO_PAYEE,
  VERDICT_UNKNOWN_ROW,
  isDeclarableCadence,
  overrideKey,
} from '@/lib/engine/recurring/override';
import {
  OVERRIDE_BAD_CADENCE,
  OVERRIDE_BAD_MERCHANT,
  OVERRIDE_DEMO_BLOCKED,
  clearRecurringOverride,
  declarationBlockedReason,
  seriesKeyForRow,
  setRecurringOverride,
} from '@/server/recurring-overrides';
import { refreshRecurringForUser, getRecurring } from '@/server/recurring';
import { setRecurringPaidThrough } from '@/server/recurring-paid-through';
import { paidThisCycleRefusal } from '@/lib/engine/recurring/paid-through';

// NOTE: a `'use server'` file may export nothing but async functions — the two
// refusal sentences this file returns therefore live in the engine leaf beside the
// rules they refuse for (L.7, the same boundary rule `transaction-detail-params.ts`
// records from the other direction).
export type RecurringVerdictResult =
  | { ok: true; projectionsRefreshed: boolean }
  | { ok: false; error: string };

/** Every surface a verdict moves: live-detection pages, and the cash surfaces the
 *  refreshed `ScheduledTransaction` rows feed. */
function revalidateProjections(): void {
  revalidatePath('/recurring');
  revalidatePath('/transactions');
  revalidatePath('/dashboard');
  revalidatePath('/calendar');
  revalidatePath('/forecast');
  revalidatePath('/spending-plan');
  revalidatePath('/coach');
}

/** Re-derive the stored projections. Reports whether it actually ran, so no
 *  caller can claim a cash surface moved when it did not. */
async function refreshProjections(userId: string): Promise<boolean> {
  try {
    await refreshRecurringForUser(userId, isoDate(getProvider().today(userId)));
    return true;
  } catch {
    return false;
  }
}

/**
 * "This IS a bill, and it charges <cadence>" — said while standing on one of its
 * charges. The payee is resolved from the ROW, server-side: the instruction is
 * about a merchant, and taking the name from the client would let a forged form
 * write a verdict about a payee the reader never saw.
 */
export async function markTransactionAsBill(input: {
  transactionId: string;
  cadence: string;
}): Promise<RecurringVerdictResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: OVERRIDE_DEMO_BLOCKED };
  if (!isDeclarableCadence(input.cadence)) return { ok: false, error: OVERRIDE_BAD_CADENCE };
  if (typeof input.transactionId !== 'string' || input.transactionId.trim() === '') {
    return { ok: false, error: VERDICT_UNKNOWN_ROW };
  }

  const row = await prisma.transaction.findFirst({
    where: { id: input.transactionId, account: { userId } },
    select: { id: true, rawDescriptor: true, amountCents: true, isTransfer: true, isSplitParent: true },
  });
  if (!row) return { ok: false, error: VERDICT_UNKNOWN_ROW };
  // THE SAME refusals the menu shows disabled and the detail page renders instead
  // of a form — enforced here because a disabled control is one dev-tools edit from
  // a submitted form, and because the first cut enforced them nowhere: a transfer
  // stored an instruction detection can never match and reported success (reader
  // critic P1-2), and an aggregate payee (`Check`, `Venmo`, …) would have projected
  // whichever unrelated payment happened to come last (money critic P0-1).
  const blocked = declarationBlockedReason(row);
  if (blocked !== null) return { ok: false, error: blocked };
  // Keyed on the NORMALIZED descriptor — the string `detectRecurring` groups by —
  // and not on the row's `Merchant`, which is null for every hand-entered charge.
  // See `seriesKeyForRow`: an e2e caught the merchant-keyed version refusing every
  // manual row, which is precisely the population this feature exists for.
  const merchantCanonical = seriesKeyForRow(row.rawDescriptor);
  if (merchantCanonical.trim() === '') return { ok: false, error: VERDICT_NO_PAYEE };

  const saved = await setRecurringOverride(userId, {
    merchantCanonical,
    decision: 'BILL',
    cadence: input.cadence,
    // The direction he was standing on, carried into the instruction: without it
    // the engine falls back to the majority sign for that payee, which turned a
    // purchase with two refunds against it into projected income (money critic).
    declaredSign: row.amountCents > 0 ? 'IN' : 'OUT',
    sourceTransactionId: row.id,
  });
  if (!saved.ok) return saved;

  await auditLog(userId, 'recurring.verdict.bill', {
    merchantCanonical,
    cadence: input.cadence,
    transactionId: row.id,
  });
  const projectionsRefreshed = await refreshProjections(userId);
  revalidateProjections();
  return { ok: true, projectionsRefreshed };
}

/**
 * "This is NOT a bill" — said from /recurring, where a false detection is what the
 * reader can actually see. The canonical comes from the client here because that
 * page has no transaction id in hand; it is only a key, scoped to the caller's own
 * rows, so the worst a bad one can do is store an instruction that matches nothing.
 */
export async function markMerchantNotABill(input: {
  merchantCanonical: string;
}): Promise<RecurringVerdictResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: OVERRIDE_DEMO_BLOCKED };
  const saved = await setRecurringOverride(userId, {
    merchantCanonical: input.merchantCanonical,
    decision: 'NOT_BILL',
    cadence: null,
  });
  if (!saved.ok) return saved;

  await auditLog(userId, 'recurring.verdict.notABill', { merchantCanonical: input.merchantCanonical });
  const projectionsRefreshed = await refreshProjections(userId);
  revalidateProjections();
  return { ok: true, projectionsRefreshed };
}

/**
 * Withdraw a verdict — the undo for both levers. Detection re-runs from the
 * transactions, so this restores exactly what the app would have said on its own;
 * there is no third state.
 */
export async function clearRecurringVerdict(input: {
  merchantCanonical: string;
}): Promise<RecurringVerdictResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: OVERRIDE_DEMO_BLOCKED };
  if (typeof input.merchantCanonical !== 'string' || input.merchantCanonical.trim() === '') {
    return { ok: false, error: OVERRIDE_BAD_MERCHANT };
  }
  const cleared = await clearRecurringOverride(userId, input.merchantCanonical);
  if (!cleared.ok) return cleared;

  await auditLog(userId, 'recurring.verdict.cleared', { merchantCanonical: input.merchantCanonical });
  const projectionsRefreshed = await refreshProjections(userId);
  revalidateProjections();
  return { ok: true, projectionsRefreshed };
}

/**
 * Record that the currently projected occurrence of a repeating bill paid.
 * Advances the next date. Does not write a transaction or move a balance.
 * Demo cannot learn. Refresh is part of the write, same as a bill verdict.
 */
export async function recordRepeatingBillPaidThisCycle(input: {
  merchantCanonical: string;
}): Promise<RecurringVerdictResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: OVERRIDE_DEMO_BLOCKED };
  const canonical = String(input.merchantCanonical ?? '').trim();
  if (!canonical) return { ok: false, error: OVERRIDE_BAD_MERCHANT };

  const data = await getRecurring(userId);
  const item =
    data.summary.items.find((s) => overrideKey(s.merchantCanonical) === overrideKey(canonical)) ??
    null;
  if (!item) {
    return { ok: false, error: paidThisCycleRefusal(null)! };
  }
  const refusal = paidThisCycleRefusal(item);
  if (refusal) return { ok: false, error: refusal };

  const saved = await setRecurringPaidThrough(userId, item.merchantCanonical, item.nextExpectedAt);
  if (!saved.ok) return { ok: false, error: saved.error };
  await auditLog(userId, 'recurring.paidThisCycle', {
    merchantCanonical: item.merchantCanonical,
    paidThrough: item.nextExpectedAt,
  });
  const projectionsRefreshed = await refreshProjections(userId);
  revalidateProjections();
  return { ok: true, projectionsRefreshed };
}

