/**
 * Reimbursement tracker (O.15 slice 2) — a refund the reader is WAITING for,
 * as a first-class fact instead of a memory.
 *
 * `Transaction.reimbursement` is a free String column narrowed here:
 * null/unknown = untracked, 'awaiting' = the reader expects this purchase
 * back, 'received' = it came back. Everything in this module is pure and
 * display-time; nothing here changes how any row SUMS:
 *
 *  - Marking a row 'awaiting' does not remove it from spending. The money is
 *    genuinely gone until it comes back; the tracker is the honest middle
 *    state. A reader who wants the row out of their budgets uses the separate
 *    `excludeFromTotals` lever — two explicit controls, never one inferred
 *    from the other, so the pair can never double-remove a row (the
 *    double-count failure this slice's critic is pointed at).
 *  - The outstanding line counts AWAITING OUTFLOWS only, each row once, by
 *    |amountCents|. A 'received' row leaves the line; an inflow marked
 *    awaiting (nonsensical, and the menu refuses it) is ignored rather than
 *    summed; a split parent never counts (its children carry the money).
 *  - An awaiting row that is ALSO excluded still counts here: this line is
 *    "cash owed to you", not a spending total, and being owed money is true
 *    whether or not the purchase counts in a budget.
 *  - `findOffsettingInflow` is a SUGGESTION, computed fresh from the rows at
 *    read time and never persisted: an exact-magnitude inflow within the
 *    match window. It is shown as "likely this deposit", never silently
 *    linked into any figure — no schema link, so nothing can drift or
 *    double-apply.
 */
import { type Cents, cents } from '@/lib/money';
import { compareDates, daysBetween, isoDate } from '@/lib/dates';

export type ReimbursementState = 'awaiting' | 'received';

/** Narrow the stored string: anything unrecognized reads as untracked, never
 *  as a state it is not (same posture as `isTaxClass`). */
export function reimbursementState(value: string | null | undefined): ReimbursementState | null {
  return value === 'awaiting' || value === 'received' ? value : null;
}

export interface ReimbTxn {
  id: string;
  date: string; // YYYY-MM-DD
  amountCents: number; // signed: outflow negative
  reimbursement: string | null;
  isTransfer?: boolean;
  isSplitParent?: boolean;
  status?: string;
}

export interface OutstandingReimbursements {
  /** Awaiting outflow rows (each once). */
  count: number;
  /** Sum of their magnitudes, positive-signed. */
  totalCents: Cents;
}

/** The dashboard/coach line: what the reader is still owed. */
export function outstandingReimbursements(txns: readonly ReimbTxn[]): OutstandingReimbursements {
  let count = 0;
  let total = 0;
  for (const t of txns) {
    if (reimbursementState(t.reimbursement) !== 'awaiting') continue;
    if (t.isSplitParent) continue; // container — children carry the money
    // O.15 critic P1-3: transfer detection can re-flag a tracked row at any
    // sync, and every total then calls it own-account movement — a "you're
    // owed" claim about it would contradict the rest of the app. The menu
    // keeps "Stop tracking" reachable on exactly these rows.
    if (t.isTransfer) continue;
    if (t.amountCents >= 0) continue; // only a purchase can be owed back
    count += 1;
    total += -t.amountCents;
  }
  return { count, totalCents: cents(total) };
}

/** How long after the purchase an inflow may still be proposed as its refund. */
export const REIMBURSEMENT_MATCH_WINDOW_DAYS = 90;

export interface OffsettingInflowMatch {
  id: string;
  date: string;
  amountCents: number;
}

/**
 * The inflow that most plausibly pays this purchase back: EXACT opposite
 * amount, POSTED, on/after the purchase date and within the match window,
 * not a transfer or split container, and not itself a tracked purchase.
 * Earliest such inflow wins (id tiebreak, fully deterministic); null when
 * nothing qualifies — an honest "no match" beats a fuzzy guess about money.
 */
export function findOffsettingInflow(
  purchase: ReimbTxn,
  candidates: readonly ReimbTxn[],
): OffsettingInflowMatch | null {
  if (purchase.amountCents >= 0) return null;
  let best: ReimbTxn | null = null;
  for (const c of candidates) {
    if (c.id === purchase.id) continue;
    if (c.amountCents !== -purchase.amountCents) continue;
    if (c.isTransfer || c.isSplitParent) continue;
    if ((c.status ?? 'POSTED') !== 'POSTED') continue;
    if (reimbursementState(c.reimbursement) !== null) continue;
    // Shared date module only (CLAUDE.md rule 3): signed day count — negative
    // means the inflow PRECEDES the purchase, which can't be its refund.
    const gap = daysBetween(isoDate(purchase.date), isoDate(c.date));
    if (gap < 0 || gap > REIMBURSEMENT_MATCH_WINDOW_DAYS) continue;
    if (
      best === null ||
      compareDates(isoDate(c.date), isoDate(best.date)) < 0 ||
      (c.date === best.date && c.id < best.id)
    ) {
      best = c;
    }
  }
  return best ? { id: best.id, date: best.date, amountCents: best.amountCents } : null;
}
