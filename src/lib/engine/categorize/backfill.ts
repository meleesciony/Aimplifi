/**
 * Backfill planner (DECISIONS #116) — PURE. Re-runs the *current* deterministic
 * categorizer over a user's existing UNSURE rows (the review pile + anything left
 * uncategorized) and returns the subset that now resolve CONFIDENTLY. This is how
 * normalize-table improvements reach transactions that were ingested before those
 * rules existed: the keyword/merchant layer only runs at ingest, so older rows
 * keep whatever verdict the categorizer gave *then* until something re-files them.
 *
 * It is the planner only — no I/O. The server action applies the plan through the
 * same write the ingest path uses (categoryId + honest confidenceBps + clear
 * needsReview); it deliberately does NOT mark these as user-confirmed (no
 * CategoryPrediction ground truth, no 9900), because a backfill is the SYSTEM
 * re-categorizing, not the user accepting.
 *
 * Safety rails, all enforced here so they're unit-testable:
 *  - Only UNSURE rows are touched — a row the user (or a confident auto-file)
 *    already settled is never overwritten.
 *  - Split-parent containers (categoryId intentionally null, excluded from every
 *    sum) are never re-filed.
 *  - The categorizer must come back CONFIDENT and CONCRETE (not needsReview, not
 *    `uncategorized`); otherwise the row stays in review.
 *  - Sign guard (#44): an INFLOW (positive amount) is never auto-filed into a
 *    spend category — only an Income-group category or transfer is
 *    sign-appropriate (#163: income split into paycheck/interest-income/… leaves,
 *    so the guard checks the GROUP, not the single 'income' id) — so a refund or
 *    credit can't be silently booked as spending.
 */
import { CATEGORY_BY_ID } from './categories';
import { categorize, type CategorySource, type RuleLike } from './pipeline';

export interface BackfillRow {
  id: string;
  rawDescriptor: string;
  /** Signed cents; negative = outflow/spend. */
  amountCents: number;
  date: string; // YYYY-MM-DD
  accountId: string;
  categoryId: string | null;
  needsReview: boolean;
  isSplitParent?: boolean;
}

export interface BackfillRefile {
  id: string;
  fromCategoryId: string | null;
  toCategoryId: string;
  confidenceBps: number;
  source: CategorySource;
}

export interface BackfillPlan {
  /** Rows that now resolve confidently → re-file these. */
  refiles: BackfillRefile[];
  /** UNSURE rows considered (the denominator the user cares about). */
  scanned: number;
  /** UNSURE rows the improved categorizer still can't settle → stay in review. */
  stillUnsure: number;
}

/** A row the categorizer never committed: in review, or left uncategorized. */
function isUnsure(r: BackfillRow): boolean {
  return r.needsReview || (r.categoryId ?? 'uncategorized') === 'uncategorized';
}

/**
 * Plan a deterministic re-categorization of `rows` using the user's `rules`.
 * Pure: same inputs → same plan. The order of `refiles` follows `rows`.
 */
export function planBackfill(
  rows: readonly BackfillRow[],
  rules: readonly RuleLike[] = [],
  /** Per-user AUTO_FLAGGED boundary (threshold tuning, DECISIONS #190); undefined = global. */
  flaggedBps?: number,
): BackfillPlan {
  const refiles: BackfillRefile[] = [];
  let scanned = 0;
  let stillUnsure = 0;

  for (const r of rows) {
    if (r.isSplitParent) continue; // never re-file a split container
    if (!isUnsure(r)) continue; // only the backlog — never clobber a settled row
    scanned++;

    const out = categorize(
      { rawDescriptor: r.rawDescriptor, amountCents: r.amountCents, date: r.date, accountId: r.accountId },
      rules,
      { flaggedBps },
    );

    // Must be a confident, concrete verdict — otherwise leave it for the human.
    if (out.needsReview || out.categoryId === 'uncategorized') {
      stillUnsure++;
      continue;
    }
    // Sign guard (#44): don't book an inflow as spend. Any Income-GROUP leaf
    // (paycheck, interest-income, tax-refund, …) is sign-appropriate (#163).
    const isIncomeGroup = CATEGORY_BY_ID.get(out.categoryId)?.group === 'Income';
    if (r.amountCents > 0 && !isIncomeGroup && out.categoryId !== 'transfer') {
      stillUnsure++;
      continue;
    }

    refiles.push({
      id: r.id,
      fromCategoryId: r.categoryId ?? null,
      toCategoryId: out.categoryId,
      confidenceBps: out.confidenceBps,
      source: out.source,
    });
  }

  return { refiles, scanned, stillUnsure };
}
