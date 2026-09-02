/**
 * Inbox (triage) reader-facing copy. Inbox is merchant groups in needsReview.
 * The unclassified row queue is Activity (Needs a category). Live 2026-09-01
 * the page still described Inbox as "transactions that still need a category"
 * after filing moved. These strings are the one author of that claim.
 */
export const INBOX_PAGE_SUBTITLE =
  'Merchant groups flagged for review — not the Needs a category list on Activity. Accuracy below is how often auto-file matched a later label — not a promise that this list is small.';

export const INBOX_NAV_DESCRIPTION =
  'Merchant groups flagged for review.';

export const INBOX_EMPTY_TITLE = 'Merchant groups flagged for review land here';

export const INBOX_EMPTY_DESCRIPTION =
  'Once a bank is connected or a CSV is pasted, this inbox collects merchant groups flagged for review. Rows that still need a category are on Activity.';

export const INBOX_EMPTY_FOOTNOTE =
  'Your data is private to your account. Connect a bank or paste a CSV. File uncategorized rows on Activity; this inbox is merchant groups flagged for review.';
