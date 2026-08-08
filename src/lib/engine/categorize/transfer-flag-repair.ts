/**
 * H.7b — the transfer-flag repair planner (STATUS §STILL OPEN after H.7,
 * residual 1). Pure: decides, never writes.
 *
 * WHY. Pre-H.7, the sweep's flag branch had no evidence bar: any coincidental
 * same-|amount| counterpart within ±3 days set `isTransfer` on a settled row,
 * silently withholding it from every income, spending, budget, report,
 * tax-export and cash-needed total. H.7 fixed the RULE, but flags are add-only
 * by design — clearing one is itself a rewrite of figures the owner has seen —
 * so the wrongly-written flags stand (measured live 2026-08-05: 53 rows,
 * $29,848.84) until an explicit, owner-authorised repair. This module is that
 * repair's decision half.
 *
 * ONE RULE, NOT TWO (the a-guard-must-read-what-it-guards lesson, and the
 * h7-shipped-plan.mts probe's own method): a flag is declined by replaying the
 * SHIPPED `planTransferUpdates` from scratch — every `isTransfer` cleared, so
 * the rule must re-justify each flag on today's evidence. Because repair and
 * sweep share the rule, a cleared row cannot be re-flagged by the next sweep
 * unless genuinely new evidence (a new counterpart row) arrives — in which case
 * re-flagging is the rule working, not the defect returning.
 *
 * SCOPE — what may clear:
 *  - the row is flagged AND carries a settled substantive verdict
 *    (`hasCompetingVerdict` — the same predicate the overturn gate uses, so the
 *    repair's scope and the defect it repairs cannot drift apart), AND
 *  - it is not review-pinned: a pinned row is the user's to decide, never the
 *    system's (the backfill precedent; the sweep's own file branch obeys it), AND
 *  - it is POSTED, in a supported currency, and not reader-excluded (critic
 *    cycle 1, both critics independently): the claim this repair makes is
 *    "restoring returns this money to your totals", and a PENDING row can
 *    settle differently (the file branch's own refusal), while a non-USD or
 *    `excludeFromTotals` row is withheld from every total by ANOTHER gate — so
 *    clearing its mark returns $0.00 and the stated dollars would be false.
 * Everything else flagged-but-declined — still awaiting review, filed AS
 * 'transfer' by the old rule, pinned, pending, non-USD, or reader-excluded —
 * is COUNTED in `declinedOutOfScopeCount` and never touched: clearing those
 * means minting review work, unfiling a recorded filing, or claiming money no
 * figure would regain — different actions with their own consequences,
 * recorded rather than smuggled in here.
 *
 * Clearing writes `isTransfer: false` and NOTHING else: the category is the
 * settled verdict the flag was wrongly withholding, so the repair restores the
 * row to its own answer rather than deciding anything new.
 */
import { hasCompetingVerdict, planTransferUpdates, type TransferStateTxn } from './transfers';
import { isIncomeCategoryId } from './categories';

/** The planner's input row: the sweep's own shape, plus the reader-exclusion
 * flag — absent means "not excluded", so every existing sweep caller's rows
 * remain valid inputs unchanged. */
export interface TransferFlagRepairRow extends TransferStateTxn {
  excludeFromTotals?: boolean;
}

export interface TransferFlagRepairPlan {
  /** The rows to clear, in input order — full rows, so a surface can state
   * what it will change before it changes it. */
  clear: TransferFlagRepairRow[];
  /** Convenience projection of `clear` (same order). */
  clearIds: string[];
  /** Cleared money-in that returns to the totals (abs cents). */
  inflowCents: number;
  /** Cleared money-out that returns to the totals (abs cents). */
  outflowCents: number;
  /** How many cleared rows carry an Income-group verdict — the sharpest class
   * (income the owner lost), named separately for the disclosure. */
  incomeCategorisedCount: number;
  /** Flags today's rule re-justifies — kept, whatever their scope; counted so
   * the surface can say the repair is a re-check, not a purge. Together with
   * `clear` and `declinedOutOfScopeCount` this PARTITIONS `flaggedCount`
   * (critic cycle 1 P2: a pinned-but-endorsed row must not vanish from every
   * count). */
  endorsedCount: number;
  /** Flagged rows today's rule declines that this repair deliberately does NOT
   * touch: still awaiting review, filed as 'transfer', review-pinned, pending,
   * non-USD, or reader-excluded. Disclosed, never silently dropped ("no
   * silent caps"). */
  declinedOutOfScopeCount: number;
  /** Every `isTransfer: true` row seen, whatever its scope — so a surface can
   * tell "no marks exist" from "all marks check out" (a zero is a claim and
   * must name which zero). */
  flaggedCount: number;
}

export function planTransferFlagRepair(
  transactions: readonly TransferFlagRepairRow[],
): TransferFlagRepairPlan {
  // The shipped rule, asked from scratch: with every flag cleared, which rows
  // would it flag or overturn TODAY? (Replaying with flags in place answers a
  // different question — `planTransferUpdates` only proposes rows not already
  // flagged, so a swept corpus yields an empty plan by construction.)
  const fromScratch = planTransferUpdates(transactions.map((t) => ({ ...t, isTransfer: false })));
  const wouldFlagNow = new Set([...fromScratch.flagIds, ...fromScratch.overturnIds]);

  const clear: TransferFlagRepairRow[] = [];
  let inflowCents = 0;
  let outflowCents = 0;
  let incomeCategorisedCount = 0;
  let endorsedCount = 0;
  let declinedOutOfScopeCount = 0;
  let flaggedCount = 0;

  for (const t of transactions) {
    if (!t.isTransfer) continue; // unflagged rows are the sweep's business, never the repair's
    flaggedCount += 1;
    // Endorsed is judged BEFORE scope, so the three buckets partition
    // flaggedCount: endorsed + declined-out-of-scope + clear.
    if (wouldFlagNow.has(t.id)) {
      endorsedCount += 1;
      continue;
    }
    const inScope =
      hasCompetingVerdict(t) &&
      !t.reviewPinned &&
      t.status === 'POSTED' &&
      t.currencySupported &&
      t.excludeFromTotals !== true;
    if (!inScope) {
      declinedOutOfScopeCount += 1;
      continue;
    }
    clear.push(t);
    if (t.amountCents > 0) inflowCents += t.amountCents;
    else outflowCents += -t.amountCents;
    if (t.categoryId !== null && isIncomeCategoryId(t.categoryId)) incomeCategorisedCount += 1;
  }

  return {
    clear,
    clearIds: clear.map((t) => t.id),
    inflowCents,
    outflowCents,
    incomeCategorisedCount,
    endorsedCount,
    declinedOutOfScopeCount,
    flaggedCount,
  };
}
