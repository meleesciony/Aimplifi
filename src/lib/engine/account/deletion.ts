/**
 * Account-deletion engine (ROADMAP #10) — the pure parts of the "delete my data"
 * flow: the typed-confirmation gate and the human-readable summary of what will
 * be removed. The cascade itself is a single ownership-scoped `prisma.user.delete`
 * (every user-owned relation is `onDelete: Cascade` — see prisma/schema.prisma
 * and docs/PRIVACY.md §Deletion); this module holds NO DB code, so the gate and
 * the summary are unit-testable in isolation. Shared, non-personal reference data
 * (the system Category set, the global Merchant table) is NOT user-scoped and is
 * intentionally left intact.
 */

/** The exact phrase a user must type to arm the irreversible delete. */
export const DELETE_CONFIRMATION_PHRASE = 'delete my data';

/** Case-insensitive, trimmed EXACT match — the deliberate-action gate. */
export function confirmationMatches(input: string): boolean {
  return input.trim().toLowerCase() === DELETE_CONFIRMATION_PHRASE;
}

export interface DeletionCounts {
  accounts: number;
  transactions: number;
  statements: number;
  goals: number;
  budgets: number;
  rules: number;
  /**
   * O.13h. Named in this summary because it is the only thing here the reader
   * personally UPLOADED — a photograph they chose to hand over — and the policy
   * beside this control promises the confirmation "shows exactly what will be
   * removed". A list that omits their receipts does not.
   */
  attachments: number;
}

export interface DeletionSummaryRow {
  label: string;
  count: number;
}

/**
 * What the wipe will remove, as labeled counts. Rows with a zero count are
 * omitted so the preview never lists things the user doesn't have.
 */
export function deletionSummary(counts: DeletionCounts): DeletionSummaryRow[] {
  const rows: DeletionSummaryRow[] = [
    { label: 'linked accounts', count: counts.accounts },
    { label: 'transactions', count: counts.transactions },
    { label: 'statements', count: counts.statements },
    { label: 'savings goals', count: counts.goals },
    { label: 'budget targets', count: counts.budgets },
    { label: 'categorization rules', count: counts.rules },
    { label: 'receipts & documents', count: counts.attachments },
  ];
  return rows.filter((r) => r.count > 0);
}
