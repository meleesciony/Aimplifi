/**
 * The tappable dashboard summary-card surface (M.4 slice, #268 follow-up).
 *
 * Four dashboard "link cards" — Safe-to-Spend, Spending-Insights,
 * Recurring-Summary, and Ask-Aimplifi — each declared a byte-identical className:
 * the whole card is one `TrackedActedLink` affordance (rounded surface + border +
 * card fill + the hover/focus treatment that makes it read as tappable). They sit
 * side by side on /dashboard, so a drift in any one copy shows up as a card that
 * visibly changes shape next to its neighbours. Centralising them here gives the
 * M.4 beauty pass ONE place to evolve the surface, and keeps the focus ring — a
 * keyboard-a11y invariant, locked in surface-card-styles.test.ts — from being
 * dropped from all five at once by a careless edit.
 *
 * Deliberately NOT applied to the other `rounded-2xl border bg-card` surfaces,
 * which differ ON PURPOSE and folding them in would mean a pile of override props:
 *   - the non-interactive section panels (reports/trends/forecast/spending-plan)
 *     are plain `<section>`s with no tap affordance and often `p-5`;
 *   - the ask-answer card carries a `p-4` surface but adds a runtime `opacity-60`
 *     pending variant;
 *   - forecast's milestone tiles are `p-3` and centred;
 *   - `onboarding-nudge` uses the shadcn `<Card>` component, not this string.
 * This constant covers exactly the tappable summary cards it is named for. It was
 * five until O.18: Top-Spending stopped being a whole-card link so that its four
 * category rows could carry expanders (an interactive control inside an anchor is
 * invalid HTML and the anchor eats its clicks), and it now uses the static
 * sibling below with a header link inside it. The count in this sentence is a
 * claim about the codebase, so it moves when the set does.
 */
export const SURFACE_LINK_CARD_CLASS =
  'block rounded-2xl border bg-card p-4 shadow-sm transition hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

/**
 * The same surface, for a summary card that is NOT itself one big link.
 *
 * Byte-identical to `SURFACE_LINK_CARD_CLASS` minus the two things that only make
 * sense on an anchor — `block` and the whole-surface hover/focus treatment — so a
 * card that grows interactive children keeps its exact shape beside its
 * neighbours instead of drifting into a hand-written copy. Its own controls carry
 * their own focus rings.
 */
export const SURFACE_CARD_CLASS = 'rounded-2xl border bg-card p-4 shadow-sm';
