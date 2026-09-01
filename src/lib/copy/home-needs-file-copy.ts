/**
 * Home "Needs a category" chip. Live 2026-09-01 Home said "N merchants need
 * filing" and sent the reader to Inbox. Inbox is merchant groups in
 * needsReview. Activity already has the work queue: Needs a category at
 * /transactions?unclassified=1. One count, one label, one destination.
 */
export const HOME_NEEDS_FILE_HREF = '/transactions?unclassified=1';

/** Side-link on Reports/Spending uncategorized figures. Same destination as Home. */
export const NEEDS_A_CATEGORY_LINK_LABEL = 'Needs a category';

export function homeNeedsFileLabel(count: number): string {
  return count === 1 ? '1 needs a category' : `${count} need a category`;
}
