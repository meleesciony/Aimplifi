/**
 * Register deep-links (O.5) — the ONE author of every "show me the transactions
 * behind this figure" href in the app.
 *
 * Owner request, 2026-07-27: "When clicking on categories of spending like
 * insurance or groceries, that should link to all corresponding transactions
 * with that tag so user can quickly view for accuracy." The audit gesture only
 * works if the destination adds up to the figure that was clicked, so the hard
 * part of this module is not the string — it is the WINDOW.
 *
 * Why it lives beside `query.ts`: that file owns `TxnFilter`, the shape the
 * register actually filters on, and `src/app/(app)/transactions/page.tsx` is the
 * translation layer between these query params and that filter. Builder and
 * filter in one directory means a renamed param breaks a neighbouring test
 * rather than silently producing a link that filters nothing (a `?categoryId=`
 * typo would land on the UNFILTERED register — every category, a much larger
 * total, and no error anywhere).
 *
 * Scope note — no `account` param, deliberately: every per-category figure that
 * links here is summed across all of the reader's spending accounts, which is
 * already the register's default scope. Naming an account would NARROW the
 * destination below the figure that was clicked.
 */
import { monthWindow } from '@/lib/dates';

/** The register route these links target. */
export const REGISTER_PATH = '/transactions';

/**
 * A category figure and the inclusive day window it was summed over. Both dates
 * are REQUIRED: an href carrying a category but no window lands on the register's
 * default (all history), whose total is larger than any month figure that could
 * have been clicked — the failure this whole module exists to prevent. Making the
 * window a required part of the type means a caller with no window cannot build
 * the link at all, and has to come here and say why.
 */
export interface CategoryWindow {
  categoryId: string;
  /** Inclusive lower bound, YYYY-MM-DD. */
  from: string;
  /** Inclusive upper bound, YYYY-MM-DD. */
  to: string;
}

/**
 * The register, filtered to one category over one inclusive date window — or
 * `null` where no honest link exists.
 *
 * `linkable` is the set of category ids the register's own category `<select>`
 * can DISPLAY — flatten `getVisibleGroups(userId)`, the exact list
 * `transactions/page.tsx` feeds that control. It is REQUIRED, and it is the whole
 * fence, because the register will happily FILTER by an id its control cannot
 * show and the reader then lands on a correctly narrowed list whose Category box
 * reads "All categories". Rows right, control wrong is still wrong.
 *
 * Two populations fall in that hole and one condition catches both:
 *  - `uncategorized` — `getTransactions` maps a null categoryId to it before
 *    filtering, so it really does narrow the rows, but the picker omits it on
 *    purpose (categorize/assign.ts:19 — it is the absence of a decision, not
 *    somewhere you can file something).
 *  - any category the reader has HIDDEN in Settings — still summed and still
 *    printed by /reports (hiding governs pickers, not what you spent), but
 *    dropped from `getVisibleGroups`.
 * Hard-coding the first id was the original fence and it missed the second
 * entirely; asking the destination's own option list is the condition rather
 * than one of its instances.
 *
 * Returning null instead of exposing an `isLinkable()` predicate is deliberate:
 * a predicate must be remembered at each call site and this repo has been bitten
 * by exactly that. Here the only way to obtain a href is through the function
 * that refuses, so every present and future surface inherits it by construction,
 * and the type makes each caller write the not-a-link branch. The set is a
 * required argument rather than an optional one for the same reason a defaulted
 * fence fails silent.
 *
 * Param names are the ones `transactions/page.tsx` reads (`category`, `from`,
 * `to`). `URLSearchParams` handles encoding, which matters for CUSTOM category
 * ids — system ids are slugs like `groceries`, but a user-created category's id
 * is a generated string that must survive the round trip verbatim to match on
 * the far side.
 */
export function categoryRegisterHref(
  { categoryId, from, to }: CategoryWindow,
  linkable: ReadonlySet<string>,
): string | null {
  if (!linkable.has(categoryId)) return null;
  const params = new URLSearchParams({ category: categoryId, from, to });
  return `${REGISTER_PATH}?${params.toString()}`;
}

/**
 * The register, filtered to one category over one calendar month ("YYYY-MM").
 *
 * The common case by far: `/reports`, the dashboard breakdown and the trends
 * movers all sum whole calendar months (`spendingByCategory` windows by month
 * key), so they hand over the month they displayed and the day boundaries are
 * derived by the tested date module instead of at each call site.
 */
export function categoryMonthRegisterHref(
  categoryId: string,
  month: string,
  linkable: ReadonlySet<string>,
): string | null {
  const { from, to } = monthWindow(month);
  return categoryRegisterHref({ categoryId, from, to }, linkable);
}
