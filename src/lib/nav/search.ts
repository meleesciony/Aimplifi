/**
 * `matchesQuery` / `searchDestinations` — the pure half of "let me type what I want".
 *
 * Rules, and why each one:
 *
 * - **An empty query matches everything.** The search box is an accelerator laid over the menu,
 *   never a gate in front of it. A reader who opens the sheet and types nothing must see exactly
 *   the menu they saw before this existed, or the change has removed navigation rather than
 *   added to it.
 * - **Tokens are ANDed.** "card payment" should narrow, not widen; ORing tokens makes every
 *   multi-word query return most of the app, which is indistinguishable from no search at all.
 * - **A token may match ANY field** — label, description, or keyword. The label is the app's word
 *   for the thing and the reader arrives with their own ("subscriptions" for Recurring, "budget"
 *   for two different pages), so matching only labels would rebuild the memory test this exists
 *   to remove.
 * - **Substring, not prefix.** "scriptions" is a typo-shaped input a prefix match silently fails;
 *   the result set here is at most nineteen items, so the precision a prefix buys is worth
 *   nothing and the recall it costs is real.
 * - **Catalogue order is preserved, never relevance-ranked.** A stable order means the same query
 *   always puts the same destination in the same place, and with nineteen items a scoring
 *   function would only add a way for the ordering to surprise someone.
 */

import type { NavDestination } from './destinations';

/** Lowercased, whitespace-collapsed query tokens. Empty array for a blank query. */
function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Does this destination match every token in the query?
 *
 * Exported for its own tests: the AND-across-tokens / OR-across-fields rule is the whole
 * behaviour, and it is much easier to pin one destination against a table of queries than to
 * assert on filtered arrays.
 */
export function matchesQuery(destination: NavDestination, query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const haystack = [
    destination.label,
    destination.description,
    ...destination.keywords,
  ]
    .join(' ')
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * The destinations a query should show, in catalogue order.
 *
 * Returns an empty array for a query that matches nothing — a real state the surface must render
 * as "nothing matched", never as an empty menu. An empty list and a menu that failed to load look
 * identical, and only one of them is the reader's fault.
 */
export function searchDestinations(
  destinations: readonly NavDestination[],
  query: string,
): NavDestination[] {
  return destinations.filter((d) => matchesQuery(d, query));
}
