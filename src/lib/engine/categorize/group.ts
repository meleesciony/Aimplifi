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
 *   - merchantless rows (CSV/manual): canonical payee, so store-number
 *     variants of one unknown merchant are one Inbox decision (DECISIONS #585).
 *     Aggregates stay exact-descriptor. Merchant-attached rows stay on m:.
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
  /** O.15 (cycle-2 P2): the inbox's split tool must refuse a tracked row with
   *  the shared sentence BEFORE the server throw — a thrown server-action
   *  message is masked to a digest in production, so the client-side gate is
   *  the only place the reader can actually read the reason. */
  reimbursement: string | null;
  aggregate: boolean;
  /**
   * The pipeline's verdict for this row, or null when it has none
   * ('uncategorized') — the group NEVER fabricates a guess (the baseline's
   * bestGuess suggested 'Shopping' on 144 of 144 cards).
   */
  suggestedCategoryId: string | null;
  /**
   * The PROVIDER's own category guess for this row (Plaid PFC → our taxonomy), or
   * null. Persisted at ingest and surfaced as a labelled "Plaid's guess" one-tap
   * suggestion when our own ruleset produced none (L.12). Distinct from
   * `suggestedCategoryId`: that is OUR confident verdict (drives "Accept all
   * confident"); this is Plaid's low-confidence guess the user confirms.
   */
  providerCategoryId: string | null;
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
  /**
   * The provider's own category guess (Plaid) for this group, or null — surfaced as a
   * labelled "Plaid's guess" one-tap suggestion ONLY when `suggestedCategoryId` is null
   * (our ruleset had none). Unanimous among the rows that carry a guess, never for an
   * aggregate group (one pick would misfile many payees). Deliberately NOT part of
   * `isConfidentGroup`: it is a per-merchant default the user confirms row-by-card,
   * never bulk-filed by "Accept all confident".
   */
  providerSuggestedCategoryId: string | null;
  /** Every queued row, newest first — powers expand-to-singles and the card meta. */
  rows: Array<
    Pick<
      ReviewRow,
      | 'id'
      | 'date'
      | 'amountCents'
      | 'rawDescriptor'
      | 'status'
      | 'accountName'
      | 'reimbursement'
      | 'suggestedCategoryId'
      | 'providerCategoryId'
    >
  >;
}


/** A durable Inbox rule hangs on a real payee, never an aggregate or a masked bank name. */
export function isDurablePayeeCanonical(canonical: string): boolean {
  const t = canonical.trim();
  if (t === '' || t === '.' || /^[.*•·]+$/.test(t)) return false;
  if (t.toLowerCase() === 'unknown merchant') return false;
  return true;
}

export function merchantlessCanonKey(canonical: string): string {
  return `canon:${canonical.normalize('NFC').trim().toLowerCase()}`;
}

export function groupKey(row: Pick<ReviewRow, 'merchantId' | 'rawDescriptor' | 'merchantCanonical' | 'aggregate'>): string {
  if (row.aggregate) return `agg:${row.rawDescriptor}`;
  if (row.merchantId) return `m:${row.merchantId}`;
  // Merchantless CSV/manual rows of one payee (store-number variants) are one
  // card. fileMerchantGroup uses the same canonical scope, so count ≡ write
  // (DECISIONS #585). Different canonicals stay separate (P0). m: cards stay
  // separate from canon: cards (cycle-2 P2).
  return merchantlessCanonKey(row.merchantCanonical);
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
    // Provider (Plaid) fallback guess: unanimous among the rows that HAVE a guess (a
    // null-opinion row rides along under the user's one-tap confirmation, same merchant),
    // and NEVER for an aggregate group — Zelle/checks/ATM group many payees under one
    // canonical, so a single "file all N" to one guessed category would misfile them.
    // This is computed here but consumed only as a FALLBACK (when `unanimous` is null);
    // it never feeds isConfidentGroup, so "Accept all confident" can never sweep it.
    const providerGuesses = members
      .map((m) => m.providerCategoryId)
      .filter((c): c is string => c !== null);
    const providerUnanimous =
      // Fallback ONLY: when OUR pipeline already has a unanimous suggestion, that wins —
      // provider stays null so `providerSuggestedCategoryId !== null` means exactly "this
      // is the fallback the inbox should show". Never for an aggregate group.
      unanimous === null && !first.aggregate && new Set(providerGuesses).size === 1
        ? providerGuesses[0]
        : null;
    groups.push({
      key,
      anchorTransactionId: first.id,
      merchantCanonical: first.merchantCanonical,
      merchantId: first.merchantId,
      aggregate: first.aggregate,
      ruleEligible: !first.aggregate && isDurablePayeeCanonical(first.merchantCanonical),
      count: members.length,
      totalCents: members.reduce((s, m) => s + m.amountCents, 0),
      newestDate: members.reduce((a, m) => (m.date > a ? m.date : a), first.date),
      oldestDate: members.reduce((a, m) => (m.date < a ? m.date : a), first.date),
      variants: [...new Set(members.map((m) => m.rawDescriptor))],
      suggestedCategoryId: unanimous,
      providerSuggestedCategoryId: providerUnanimous,
      rows: members.map((m) => ({
        id: m.id,
        date: m.date,
        amountCents: m.amountCents,
        rawDescriptor: m.rawDescriptor,
        status: m.status,
        accountName: m.accountName,
        reimbursement: m.reimbursement,
        // O.12e: singles drill-down needs the same ladder rungs the register
        // already has — group-level unanimity can be null while a row has a chip.
        suggestedCategoryId: m.suggestedCategoryId,
        providerCategoryId: m.providerCategoryId,
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

/**
 * Skip / next without filing (DECISIONS #374): move the front card to the end
 * of the queue so the reader can clear what they recognize first. Pure rotation
 * — nothing is filed, nothing leaves the queue. No-op when fewer than 2 groups
 * (there is no "next" card).
 */
export function rotateSkippedGroup<T>(groups: readonly T[]): T[] {
  if (groups.length < 2) return [...groups];
  return [...groups.slice(1), groups[0]];
}

/**
 * Honest heading when the bank masked the payee (O.12f — canonical "." or
 * punctuation-only). Amount/date still identify the charge; the name does not.
 */
export function inboxMerchantHeading(canonical: string): string {
  const t = canonical.trim();
  if (t === '' || t === '.' || /^[.*•·]+$/.test(t)) {
    return 'Masked charge (bank hid the name)';
  }
  return canonical;
}
