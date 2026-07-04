/**
 * Merchant-group review queue (PULSE_CATEGORIZATION_FIX Phase 3b).
 *
 * The queue unit is the NORMALIZED MERCHANT, not the transaction: the Phase-2
 * baseline measured 144 review rows spanning 24 merchants — a 6× inflation the
 * user paid in taps (397 to clear). One group card = one decision that files
 * every queued transaction of that merchant.
 *
 * Pure and deterministic: grouping/sorting/suggestion-unanimity live here, on
 * typed inputs, with no DB or React (CLAUDE.md rule 5 — engine before UI).
 *
 * Group keys (mirrors similarTransactionsWhere, DECISIONS #23, so a card's
 * count can never drift from the rows its action mutates):
 *   - aggregate pseudo-merchants (Zelle/checks/ATM/Venmo): EXACT rawDescriptor
 *     — "6 payments to J. Park", never "all Zelle";
 *   - real merchants: merchantId;
 *   - merchantless rows: the canonical string (defensive — ingest always
 *     upserts a Merchant, but a null merchantId must not crash the queue).
 */

export interface ReviewRow {
  id: string;
  merchantId: string | null;
  merchantCanonical: string;
  rawDescriptor: string;
  amountCents: number;
  /** YYYY-MM-DD */
  date: string;
  accountName: string;
  status: string;
  aggregate: boolean;
  /**
   * The pipeline's verdict for this row, or null when it has none
   * ('uncategorized') — the group NEVER fabricates a guess (the baseline's
   * bestGuess suggested 'Shopping' on 144 of 144 cards).
   */
  suggestedCategoryId: string | null;
}

export interface TriageGroup {
  key: string;
  /** Newest row — server actions re-derive the group scope from this row. */
  anchorTransactionId: string;
  merchantCanonical: string;
  merchantId: string | null;
  aggregate: boolean;
  /** Aggregates never get durable rules (one "Always" would mis-file unrelated payees). */
  ruleEligible: boolean;
  count: number;
  totalCents: number;
  newestDate: string;
  oldestDate: string;
  /** Distinct raw descriptor variants in this group (evidence of convergence). */
  variants: string[];
  /**
   * Unanimous pipeline suggestion across the group's rows, else null.
   * null = "you decide once" — never a fabricated amount-based guess.
   */
  suggestedCategoryId: string | null;
  /** Every queued row, newest first — powers expand-to-singles and the card meta. */
  rows: Array<Pick<ReviewRow, 'id' | 'date' | 'amountCents' | 'rawDescriptor' | 'status' | 'accountName'>>;
}

export function groupKey(row: Pick<ReviewRow, 'merchantId' | 'rawDescriptor' | 'merchantCanonical' | 'aggregate'>): string {
  if (row.aggregate) return `agg:${row.rawDescriptor}`;
  if (row.merchantId) return `m:${row.merchantId}`;
  // Merchantless rows key by EXACT descriptor — the same scope the file action
  // uses (similarTransactionsWhere), so the card's count can never exceed what
  // one tap actually files (Phase-3 checker P0: a canonical-keyed card over a
  // descriptor-scoped action either under-files or, worse pre-fix, mass-files).
  return `raw:${row.rawDescriptor}`;
}

/**
 * Group review rows into merchant groups, sorted for LEVERAGE: biggest group
 * first (one decision clears the most rows), newest-date tiebreak, canonical
 * as the stable final tiebreak. Input rows are expected newest-first (the
 * queue's existing order); each group's rows preserve that order, and the
 * anchor is the group's newest row.
 */
export function groupReviewRows(rows: ReviewRow[]): TriageGroup[] {
  const byKey = new Map<string, ReviewRow[]>();
  for (const r of rows) {
    const k = groupKey(r);
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }

  const groups: TriageGroup[] = [];
  for (const [key, members] of byKey) {
    const first = members[0]; // newest (input order preserved)
    const suggestions = new Set(members.map((m) => m.suggestedCategoryId));
    const unanimous = suggestions.size === 1 ? first.suggestedCategoryId : null;
    groups.push({
      key,
      anchorTransactionId: first.id,
      merchantCanonical: first.merchantCanonical,
      merchantId: first.merchantId,
      aggregate: first.aggregate,
      ruleEligible: !first.aggregate && first.merchantId !== null,
      count: members.length,
      totalCents: members.reduce((s, m) => s + m.amountCents, 0),
      newestDate: members.reduce((a, m) => (m.date > a ? m.date : a), first.date),
      oldestDate: members.reduce((a, m) => (m.date < a ? m.date : a), first.date),
      variants: [...new Set(members.map((m) => m.rawDescriptor))],
      suggestedCategoryId: unanimous,
      rows: members.map((m) => ({
        id: m.id,
        date: m.date,
        amountCents: m.amountCents,
        rawDescriptor: m.rawDescriptor,
        status: m.status,
        accountName: m.accountName,
      })),
    });
  }

  groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.newestDate !== a.newestDate) return b.newestDate > a.newestDate ? 1 : -1;
    return a.merchantCanonical < b.merchantCanonical ? -1 : 1;
  });
  return groups;
}

/**
 * "Accept all confident" support (DECISIONS #162): a group is CONFIDENT when the
 * pipeline gave it a unanimous, honest suggestion. `groupReviewRows` only sets
 * `suggestedCategoryId` when EVERY row in the group agrees (else null) and never
 * from an amount-based guess — so a non-null suggestion is exactly the bar a user
 * clears by swiping right on the card. `null` means "you decide once" and is left
 * for manual review. This one predicate is shared by the client's bulk button and
 * the server action's re-derivation, so the two can never drift on what "confident"
 * means (the same single-source discipline as similarTransactionsWhere ↔ groupKey).
 */
export function isConfidentGroup(g: Pick<TriageGroup, 'suggestedCategoryId'>): boolean {
  return g.suggestedCategoryId !== null;
}

/** The confident subset, order preserved (biggest-group-first from the sort above). */
export function selectConfidentGroups<T extends Pick<TriageGroup, 'suggestedCategoryId'>>(
  groups: readonly T[],
): T[] {
  return groups.filter(isConfidentGroup);
}

/** Merchants (groups) and total transactions "Accept all confident" would file. */
export function summarizeConfident(
  groups: readonly Pick<TriageGroup, 'suggestedCategoryId' | 'count'>[],
): { merchants: number; transactions: number } {
  let merchants = 0;
  let transactions = 0;
  for (const g of groups) {
    if (g.suggestedCategoryId !== null) {
      merchants += 1;
      transactions += g.count;
    }
  }
  return { merchants, transactions };
}
