/**
 * The auth form field style (2026-07-21 agent review, finding B5).
 *
 * Sign-in/sign-up, forgot-password, and reset-password each declared a
 * byte-identical `inputClass`. They are the same control on three pages of one
 * flow — a user moves sign-in → forgot → reset in a single sitting, so a drift in
 * any one copy shows up as a field that visibly changes shape mid-flow.
 *
 * Deliberately NOT applied to the in-app finance inputs: those are compact,
 * context-sized fields (h-8 dial inputs, table-row edits, mono statement fields)
 * whose classes differ ON PURPOSE, and folding them into one constant would mean
 * a pile of override props. This constant covers exactly the full-width auth-page
 * field it is named for.
 */
export const AUTH_INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';
