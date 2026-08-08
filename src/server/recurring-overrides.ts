/**
 * Store for the reader's own verdicts on what is a bill (O.13f / O.15 slice 4).
 *
 * Storage only, and deliberately NextAuth-free so vitest can drive it against a
 * real database (the `server/reconciliation.ts` idiom); the `'use server'` wrapper
 * with auth, audit and revalidation is `server/recurring-override-actions.ts`.
 *
 * What an instruction MEANS lives in the engine — `detectRecurring` applies it, so
 * the /recurring page, the projection writer, the merchant lens, the radar and the
 * coach all honour it in the same pass. Nothing here decides anything about money.
 *
 * The shared demo account is fenced by CONSTRUCTION: every anonymous visitor is the
 * same user row, so one visitor deleting "Netflix" as not-a-bill would rewrite the
 * hand-verified golden figures every other visitor sees (the shared-demo lesson).
 * Reads return nothing and writes are refused for that account.
 */
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';
import { isAggregateCanonical, normalizeMerchant } from '@/lib/engine/categorize/normalize';
import {
  type RecurringOverrideInput,
  VERDICT_BLOCKED_AGGREGATE,
  VERDICT_BLOCKED_SPLIT_PARENT,
  VERDICT_BLOCKED_TRANSFER,
  isDeclarableCadence,
  overrideKey,
  parseRecurringOverride,
} from '@/lib/engine/recurring/override';

/**
 * The payee an instruction must be keyed on: the NORMALIZED descriptor, which is
 * exactly what `detectRecurring` groups its series by.
 *
 * NOT `Transaction.merchant.canonical`, and the difference is not cosmetic —
 * `merchantId` is null on every manually entered row and on every feed row whose
 * merchant was never upserted, while the detector reads the raw text and always
 * produces a name. Keying on the Merchant row therefore refused the instruction
 * outright for exactly the reader who most needs it (one hand-entered charge is
 * the case a declaration exists for), and where the row DID carry a merchant an
 * O.13c rename could point it somewhere the detector never groups. A guard must
 * read the same input as the thing it guards.
 */
export function seriesKeyForRow(rawDescriptor: string): string {
  return normalizeMerchant(rawDescriptor).canonical;
}

/** Canonical merchant names are short; cap accepted length so a forged client
 *  cannot store megabyte keys (the nudge-dismissal precedent). */
const MAX_MERCHANT_LEN = 200;
/** A reader has few of these; cap the read defensively. The cap is ordered by
 *  `createdAt` so which rows survive it is deterministic rather than whatever the
 *  database happened to return first. */
const MAX_OVERRIDES_READ = 200;

/** Everything the reader has told this app about what is and is not a bill.
 *  Empty for the demo account. */
export async function getRecurringOverrides(userId: string): Promise<RecurringOverrideInput[]> {
  if (userId === DEMO_USER_ID) return [];
  try {
    const rows = await prisma.recurringOverride.findMany({
      where: { userId },
      select: { merchantCanonical: true, decision: true, cadence: true, declaredSign: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_OVERRIDES_READ,
    });
    // An unreadable row is dropped rather than guessed at (parseRecurringOverride).
    return rows.map(parseRecurringOverride).filter((o): o is RecurringOverrideInput => o !== null);
  } catch {
    // A read fault degrades to "he never said anything", i.e. detection exactly as
    // it behaved before this feature existed. Stated plainly because the direction
    // is not free: a demoted series would be projected again for as long as the
    // fault lasts. The alternative — throwing — takes down /recurring, /dashboard,
    // the radar and the coach for the same fault, and the instruction is stored,
    // not lost, so the next successful read restores it.
    return [];
  }
}

/**
 * The same instructions, for the page that lists and undoes them.
 *
 * Read through `getRecurringOverrides` — the parser the DETECTOR reads — rather
 * than raw rows, so the panel cannot list an instruction the engine ignores and
 * then describe what it is "doing" (critic P3). One list, one meaning.
 */
export async function listRecurringOverrideRows(
  userId: string,
): Promise<{ merchantCanonical: string; decision: string; cadence: string | null }[]> {
  return (await getRecurringOverrides(userId)).map((o) => ({
    merchantCanonical: o.merchantCanonical,
    decision: o.decision,
    cadence: o.cadence,
  }));
}

/**
 * The verdict standing on ONE transaction's payee — what the detail view renders.
 * `merchantCanonical` is null only when the row is not the caller's (or does not
 * exist), which is the same refusal every other per-row read makes: there is then
 * nothing to declare and nothing to disclose.
 */
export interface RowRecurringVerdict {
  merchantCanonical: string | null;
  decision: string | null;
  cadence: string | null;
  /** Why this row may not be DECLARED recurring — null when it may. */
  blockedReason: string | null;
}

export async function getRecurringVerdictForTransaction(
  userId: string,
  transactionId: string,
): Promise<RowRecurringVerdict> {
  const row = await prisma.transaction.findFirst({
    where: { id: transactionId, account: { userId } },
    select: { rawDescriptor: true, isTransfer: true, isSplitParent: true },
  });
  if (row === null || userId === DEMO_USER_ID) {
    return {
      merchantCanonical: row ? seriesKeyForRow(row.rawDescriptor) : null,
      decision: null,
      cadence: null,
      blockedReason: row ? declarationBlockedReason(row) : null,
    };
  }
  const merchantCanonical = seriesKeyForRow(row.rawDescriptor);
  // Found through the ENGINE'S folded key, not an exact-bytes `findUnique`: under
  // the O.13c case-collision residual a verdict stored as `Costco` is in force for
  // a `costco`-keyed row, and an exact lookup would show this page "no verdict"
  // while suppression ran — then mint a second, contradictory row (critic P3).
  const key = overrideKey(merchantCanonical);
  const inForce = (await getRecurringOverrides(userId)).find((o) => overrideKey(o.merchantCanonical) === key) ?? null;
  return {
    merchantCanonical,
    decision: inForce?.decision ?? null,
    cadence: inForce?.cadence ?? null,
    blockedReason: declarationBlockedReason(row),
  };
}

/**
 * Why this ROW cannot carry a "this is recurring" declaration — null when it can.
 * ONE decision point, read by the server before it writes and by the detail page
 * before it renders a form, so the screen and the wire cannot disagree.
 *
 * Applies to BILL only. A demotion is pure suppression: it can remove a projection
 * and never invent one, so refusing it would cost the reader his only lever
 * against a false detection for no safety gained.
 */
export function declarationBlockedReason(row: {
  rawDescriptor: string;
  isTransfer: boolean;
  isSplitParent: boolean;
}): string | null {
  if (row.isSplitParent) return VERDICT_BLOCKED_SPLIT_PARENT;
  if (row.isTransfer) return VERDICT_BLOCKED_TRANSFER;
  if (isAggregateCanonical(seriesKeyForRow(row.rawDescriptor))) return VERDICT_BLOCKED_AGGREGATE;
  return null;
}

export type OverrideWriteResult = { ok: true } | { ok: false; error: string };

export const OVERRIDE_BAD_MERCHANT =
  'Aimplifi could not tell which payee that is, so nothing was saved.';
export const OVERRIDE_BAD_CADENCE =
  'Pick how often this charges — a bill without a rhythm has no date to project.';
export const OVERRIDE_DEMO_BLOCKED =
  'The demo account is shared with everyone, so it does not save changes like this one.';
// C.23 critic P1-2: a NOT_BILL written by the convert lever is half a pair with
// the reserve that carries its canonical. The undo for a conversion is removing
// the reserve (which withdraws the override in the same transaction) — undoing
// the override alone would count the payee twice. Names the remedy the reader
// can actually click.
export const OVERRIDE_LINKED_RESERVE =
  'This payee is set aside as a reserve — remove the reserve on your plan page first, and the bill returns to your fixed costs.';

/**
 * A reserve linked to this payee (case-folded) — the other half of a
 * convert-lever pair (DECISIONS #431). Both sides of the override write must
 * refuse while it stands: honoring BILL re-declaration OR the override undo
 * alone returns the series to detection while the reserve still counts the
 * money — the same payee twice in the Fixed figure, with `ok: true` (C.23
 * critic P1-1). The one whole undo is removing the reserve, which withdraws
 * the NOT_BILL with it.
 */
async function hasLinkedReserve(userId: string, merchantCanonical: string): Promise<boolean> {
  const linkedReserves = await prisma.goal.findMany({
    where: { userId, kind: RESERVE_KIND, merchantCanonical: { not: null } },
    select: { merchantCanonical: true },
  });
  return linkedReserves.some(
    (g) => overrideKey(g.merchantCanonical as string) === overrideKey(merchantCanonical),
  );
}

/**
 * Record "this IS a bill, at this rhythm" or "this is NOT a bill" for one merchant.
 * Idempotent by `@@unique([userId, merchantCanonical])`: saying it twice, or
 * changing your mind, updates the one row rather than accumulating verdicts.
 */
export async function setRecurringOverride(
  userId: string,
  input: {
    merchantCanonical: string;
    decision: 'BILL' | 'NOT_BILL';
    cadence: string | null;
    declaredSign?: 'OUT' | 'IN' | null;
    sourceTransactionId?: string | null;
  },
): Promise<OverrideWriteResult> {
  if (userId === DEMO_USER_ID) return { ok: false, error: OVERRIDE_DEMO_BLOCKED };
  const merchantCanonical = typeof input.merchantCanonical === 'string' ? input.merchantCanonical.trim() : '';
  if (merchantCanonical === '' || merchantCanonical.length > MAX_MERCHANT_LEN) {
    return { ok: false, error: OVERRIDE_BAD_MERCHANT };
  }
  if (input.decision !== 'BILL' && input.decision !== 'NOT_BILL') {
    return { ok: false, error: OVERRIDE_BAD_CADENCE };
  }
  // A BILL is refused without a rhythm the engine will project. Validated HERE and
  // not only in the form: `parseRecurringOverride` would drop an unreadable row on
  // the read path, which means the reader's instruction would silently do nothing
  // — a save that reports success and changes no figure is the worst of the three
  // possible outcomes.
  if (input.decision === 'BILL' && !isDeclarableCadence(input.cadence)) {
    return { ok: false, error: OVERRIDE_BAD_CADENCE };
  }
  // C.23 critic P1-1: re-declaring a BILL on a payee the convert lever turned
  // into a reserve would resurrect the series while the reserve still counts
  // it — the same payee twice in the Fixed figure. Refuse, mirroring the
  // clear-side refusal below: the reserve's removal (which withdraws the
  // NOT_BILL with it) is the one undo that keeps the pair whole.
  if (input.decision === 'BILL' && (await hasLinkedReserve(userId, merchantCanonical))) {
    return { ok: false, error: OVERRIDE_LINKED_RESERVE };
  }
  const cadence = input.decision === 'BILL' ? (input.cadence as string) : null;
  const declaredSign =
    input.decision === 'BILL' && (input.declaredSign === 'OUT' || input.declaredSign === 'IN')
      ? input.declaredSign
      : null;
  const sourceTransactionId =
    typeof input.sourceTransactionId === 'string' && input.sourceTransactionId !== ''
      ? input.sourceTransactionId
      : null;
  await prisma.recurringOverride.upsert({
    where: { userId_merchantCanonical: { userId, merchantCanonical } },
    create: { userId, merchantCanonical, decision: input.decision, cadence, declaredSign, sourceTransactionId },
    update: { decision: input.decision, cadence, declaredSign, sourceTransactionId },
  });
  return { ok: true };
}

/**
 * Withdraw an instruction — the undo, and the whole of it: detection re-runs from
 * the transactions on the next read, so there is no state to unwind and no figure
 * that stayed rewritten.
 */
export async function clearRecurringOverride(
  userId: string,
  merchantCanonical: string,
): Promise<OverrideWriteResult> {
  if (userId === DEMO_USER_ID) return { ok: false, error: OVERRIDE_DEMO_BLOCKED };
  if (typeof merchantCanonical !== 'string' || merchantCanonical.trim() === '') {
    return { ok: false, error: OVERRIDE_BAD_MERCHANT };
  }
  const canonical = merchantCanonical.trim();
  // C.23 critic P1-2, inverse half: an override paired with a CONVERTED reserve
  // cannot be withdrawn alone. Withdrawing it returns the series to detection
  // while the reserve still counts the money — the same payee in the figure
  // twice, and the conversion's undo was already built as "remove the reserve"
  // (which withdraws the override with it). Say so; never create the double
  // count by honouring half an undo. The folded key, like every read: a
  // case-differing legacy row is the same payee and the same reserve link.
  if (await hasLinkedReserve(userId, canonical)) {
    return { ok: false, error: OVERRIDE_LINKED_RESERVE };
  }
  await prisma.recurringOverride.deleteMany({ where: { userId, merchantCanonical: canonical } });
  // A no-op delete is still `ok`: the reader asked for "no instruction here", and
  // that is the state either way.
  return { ok: true };
}
