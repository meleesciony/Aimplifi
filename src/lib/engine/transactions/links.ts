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
 * The one visual treatment for a figure that drills into the register (O.6
 * critic P1-1).
 *
 * These shipped for one critic cycle as `hover:underline` only. Measured at 380px
 * on the golden viewport: no underline, no colour delta and no weight delta
 * against the plain text beside them — the sole affordance was `:hover`, which
 * does not exist on a phone. The owner's request was that a category figure be
 * clickable; a link nobody can see is indistinguishable from not shipping it, and
 * the /trends target is a 39×16px amount inside a line of ordinary text.
 *
 * A dotted underline is the affordance rather than a solid one because these are
 * inline money figures inside sentences and totals, not navigation: it reads as
 * "inspectable" without turning every amount on the page into link-blue. It stays
 * visible on hover (solid) and keeps the focus ring for keyboard users.
 *
 * Exported from here, beside the builder, so the three surfaces cannot drift into
 * three different affordances — the same reason the href has one author.
 */
export const CATEGORY_LINK_CLASS =
  'rounded-sm underline decoration-dotted decoration-muted-foreground/70 underline-offset-2 ' +
  'hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * A category figure and the inclusive day window it was summed over. Both dates
 * are REQUIRED: an href carrying a category but no window lands on the register's
 * default (all history), whose total is larger than any month figure that could
 * have been clicked — the failure this whole module exists to prevent. Making the
 * window a required part of the type means a caller with no window cannot build
 * the link at all, and has to come here and say why.
 *
 * `amountCents` is the figure the link ASSERTS the destination adds up to. Be
 * precise about what it is and is not, because the first draft of this comment
 * overclaimed and a critic executed the counter-example: passing 1, 48998 or
 * 999999999 yields a byte-identical URL. It is a DECLARATION, not a guard, and it
 * cannot catch a caller that names the wrong figure. What it buys is that the
 * caller must name one at all, on two surfaces where the choice is genuinely
 * ambiguous — a /trends mover row prints a delta (the largest, boldest number on
 * the row), a baseline AVERAGE over up to three months, and the month's own total,
 * and only the last is a set of rows any window can reproduce; a /budgets row
 * prints spend AND a target. What actually catches a wrong choice is the
 * per-surface reconciliation test, which reads the figure the page RENDERS and
 * compares it against the register's own summary.
 */
export interface CategoryFigure {
  categoryId: string;
  /** Inclusive lower bound, YYYY-MM-DD. */
  from: string;
  /** Inclusive upper bound, YYYY-MM-DD. */
  to: string;
  /** The figure clicked, in cents, as a spend amount (0 is legitimate — see below). */
  amountCents: number;
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
 * A ZERO figure is NOT refused, and the reasoning is worth keeping because O.6
 * shipped the opposite for one critic cycle. The argument for refusing was L.29:
 * a true zero and a zero produced by an upstream defect look identical, so
 * offering an empty register as "confirmation" seemed like the unsafe direction.
 * That has it backwards. The register is the source of truth the figure is
 * derived from, so following the link is exactly how the two get compared: if
 * the surface says $0.00 and the register shows $300 of rows, the reader has
 * just FOUND the defect. Refusing the link is what hides it.
 *
 * A critic then found the concrete cost of refusing: a /trends mover is on the
 * page BECAUSE it moved, sorts first by absolute delta, and a category that fell
 * to nothing ("Travel · $0.00 vs $489.98 usual") is the most interesting row
 * there — it was rendered dead, unexplained, beside four live ones. An empty
 * destination is a real answer to "did I really spend nothing on travel".
 *
 * Param names are the ones `transactions/page.tsx` reads (`category`, `from`,
 * `to`). `URLSearchParams` handles encoding, which matters for CUSTOM category
 * ids — system ids are slugs like `groceries`, but a user-created category's id
 * is a generated string that must survive the round trip verbatim to match on
 * the far side.
 */
export function categoryRegisterHref(
  { categoryId, from, to, amountCents }: CategoryFigure,
  linkable: ReadonlySet<string>,
): string | null {
  if (!linkable.has(categoryId)) return null;
  void amountCents; // declared by the caller, not used to build the string — see above
  const params = new URLSearchParams({ category: categoryId, from, to });
  return `${REGISTER_PATH}?${params.toString()}`;
}

/**
 * The register, filtered to one category over one calendar month ("YYYY-MM").
 *
 * The common case by far — after O.6 it is every case: `/reports`, `/trends`
 * movers and `/budgets` rows all sum whole calendar months
 * (`spendingByCategory` windows by month key), so they hand over the month they
 * displayed and the day boundaries are derived by the tested date module
 * instead of at each call site.
 *
 * Takes an object rather than positional arguments deliberately: `categoryId`
 * and `month` are both strings, so a positional signature accepts them
 * transposed without a type error, and the resulting link would filter by a
 * category named "2026-06" over a window derived from a category id — an empty
 * register, no error anywhere.
 */
export function categoryMonthRegisterHref(
  { categoryId, month, amountCents }: { categoryId: string; month: string; amountCents: number },
  linkable: ReadonlySet<string>,
): string | null {
  const { from, to } = monthWindow(month);
  return categoryRegisterHref({ categoryId, from, to, amountCents }, linkable);
}
