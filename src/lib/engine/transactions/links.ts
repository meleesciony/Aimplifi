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
import type { FlowType } from '@/lib/engine/transactions/query';

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
 * The same affordance on the category NAME (owner-reported 2026-07-31, with a
 * /budgets screenshot: *"I should be able to see all transactions under that
 * category"*).
 *
 * Why a name link exists at all, when O.6 deliberately nailed the affordance to
 * the FIGURE: because on two of the three surfaces the figure is the ONLY target,
 * and it is a bad one. `/budgets` prints "$1,046.29" in `text-sm tabular-nums` —
 * roughly 62×16px on the golden 380px viewport — while the words a reader
 * actually points at ("Entertainment & Streaming", ~180px) were an inert
 * `<span>`. `/reports` never had this problem because its whole row is the
 * anchor, which is also the evidence that a row-wide target is the right shape;
 * `/budgets` cannot copy it verbatim, because its row carries a
 * `ClearBudgetButton`, and an interactive control nested inside an anchor is
 * invalid HTML that swallows the button's own clicks. Two sibling anchors to one
 * href is the honest way to get the same reach without nesting.
 *
 * It carries NO font-weight, and that is the difference from `MERCHANT_LINK_CLASS`
 * rather than an omission. Weight is a fact about the row: a /trends mover name is
 * already `font-medium`, a /budgets category name is not, and a shared constant
 * that picked one would silently restyle the other. The call site keeps the
 * weight; this constant contributes only the "inspectable" cue and the focus ring.
 *
 * The link is a claim of equality exactly as the figure's is — same href, same
 * builder, same refusal — so it inherits the whole O.5/O.6 fence and adds no new
 * assertion about what the destination sums to.
 */
export const CATEGORY_NAME_LINK_CLASS =
  'rounded-sm underline decoration-dotted decoration-muted-foreground/70 underline-offset-2 ' +
  'hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * The one visual treatment for a merchant NAME that drills into the register.
 *
 * It carries a RESTING dotted underline, matching `CATEGORY_LINK_CLASS`, and
 * that is the one deliberate visual change in this slice rather than an
 * accident. The register's merchant name shipped for months as
 * `font-medium hover:underline`: no underline, no colour delta and no weight
 * delta against the text beside it, so its only affordance was `:hover`, which
 * does not exist on a phone. That is verbatim the defect measured at 380px and
 * recorded above for category figures, and the fix has to be the same one —
 * this slice exists to make these names discoverable, and a link nobody can see
 * is indistinguishable from not shipping it. Matching the category treatment is
 * also the cohesion the owner actually asked for: one "inspectable" idiom across
 * the app instead of two, so a reader learns it once.
 *
 * The cost is honest and reversible in one constant: a register of fifty rows
 * now shows fifty dotted underlines. Dotted rather than solid, at muted colour,
 * keeps that from reading as fifty blue links.
 *
 * `focus-visible` is the other addition: every hand-written copy of this markup
 * omitted it, so the links were reachable by keyboard and invisible once
 * reached.
 *
 * ONE call site deliberately does NOT use this constant, and it is not drift:
 * `transaction-detail-view.tsx`'s "Every X transaction" is a footer nav link
 * sitting beside "Back to transactions", already carries a resting solid
 * underline, and must match its neighbour rather than the row idiom. Every other
 * merchant link in the app uses this.
 *
 * No `truncate` here. Whether a name may be clipped is a fact about the LAYOUT
 * it sits in — a register row truncates, a sentence in the Today feed must not —
 * so each call site adds it, and `min-w-0` on the flex parent, itself (the iOS
 * flexbox lesson: a `truncate` with no `min-w-0` ancestor silently overflows).
 */
export const MERCHANT_LINK_CLASS =
  'rounded-sm font-medium underline decoration-dotted decoration-muted-foreground/70 ' +
  'underline-offset-2 hover:decoration-solid ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2';

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

/**
 * The register, filtered to one merchant across ALL history (O.15 slice 1).
 *
 * Deliberately window-less, and that is the difference from every category link
 * above rather than an oversight. A category link is hung on a FIGURE — a month
 * total, a mover's month spend — so a missing window silently widens the
 * destination past the number that was clicked, which is the whole reason
 * `CategoryFigure` makes `from`/`to` required. A merchant link is hung on a
 * NAME: "Netflix" is not an amount, so there is no sum for the destination to
 * disagree with, and the reader asking "what is this?" wants every charge, not
 * the ones inside a window they never chose. The register's own default scope is
 * all history, so this lands exactly where its Merchant filter would.
 *
 * It returns a plain `string`, not `string | null` — but NOT because the
 * rows-right/control-wrong hole is absent here. A first draft of this comment
 * claimed the register has "a free-text merchant box that displays whatever it
 * is given"; a critic checked, and there is no such control.
 * `transaction-filters.tsx` renders Type / Account / Category / From / To only,
 * and re-serialises `merchant` into the URL without ever showing it. The name is
 * echoed by the Merchant Lens card, which `transactions/page.tsx` renders as
 * `{lens && …}` and whose engine ABSTAINS on thin history and on aggregate
 * pseudo-merchants — so on exactly the sparse merchants where the destination
 * looks emptiest, nothing on the page names what it was narrowed to.
 *
 * That is a real weakness, and it is recorded rather than dressed up. It is not
 * fixed by refusing to build the href: unlike a category id, which can be
 * checked against the picker's own option list before linking, there is no
 * predicate a builder could evaluate here — every merchant name is equally
 * displayable and equally unshown. The fence would have to be a merchant control
 * on the register, which is a UI task and is queued as one. The two links that
 * predate this slice already had the same gap.
 *
 * A caller that must not link — the household shared list, whose rows belong to
 * a PARTNER while this register is scoped to the reader — is refused by not
 * calling this at all, with the reason written at the call site.
 *
 * Centralising the ENCODING is the concrete reason this is one function rather
 * than an inline template literal per surface: merchant names carry `&` ("Barnes
 * & Noble"), `#` and `+` far more often than category slugs — lowercase ASCII by
 * construction — do, and an escape that is right at the call sites that have one
 * and forgotten at the next one added truncates the filter silently, giving a
 * narrower register and no error anywhere.
 *
 * `encodeURIComponent`, NOT `URLSearchParams`, and the difference is load-bearing
 * even though both round-trip through a `URLSearchParams` reader (measured: `+`
 * and `%20` both read back as a space). `URLSearchParams.toString()` emits a
 * space as `+`, which is only a space to a parser applying form-encoding rules;
 * `%20` is a space to every query parser there is. The TWO merchant links that
 * were already shipped (`transaction-list.tsx`, `transaction-detail-view.tsx`)
 * emit `%20`, so keeping that byte-for-byte is what makes this refactor provably
 * unable to move where an existing link lands. A link silently filtering to
 * "Blue+Bottle+Coffee" would match nothing while still returning HTTP 200.
 */
export function merchantRegisterHref(merchant: string): string {
  return `${REGISTER_PATH}?merchant=${encodeURIComponent(merchant)}`;
}

/**
 * The register, windowed to one calendar month and filtered no further.
 *
 * Built for the /reports income-vs-spending chart, and the narrowness is the
 * point. A bar there is one HALF of a month — the rows `monthlyFlows` counted as
 * income, or the ones it counted as spending — and the register cannot express
 * either half:
 *
 *   - `type=expense` is `amountCents < 0`, which DROPS the refunds the bar
 *     netted against spending, and KEEPS the pending charges and the rows the
 *     reader excluded from totals, neither of which the bar ever saw.
 *   - There is no param for "not income", and adding one would put a fifth
 *     basis on a page that already has enough.
 *
 * So this link deliberately claims LESS than the panel above it: it opens the
 * month, and its label says so. The rows themselves are already listed in the
 * panel — each one linking to its own detail page, which is where a row gets
 * re-filed — so nothing is lost by refusing to assert an equality that would be
 * false. A link on a figure is a claim that two engines agree
 * (`a-link-on-a-figure-asserts-two-engines-agree`); this one is a claim about a
 * window, which is a claim both sides can keep.
 */
export function monthRegisterHref(month: string): string {
  const { from, to } = monthWindow(month);
  const params = new URLSearchParams({ from, to });
  return `${REGISTER_PATH}?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* O.16 — carrying the reader's PLACE back out of a row action                 */
/* -------------------------------------------------------------------------- */

/**
 * The query param that carries where the reader was standing.
 *
 * Deliberately NOT flattened into the destination's own query string, and the
 * reason is a live collision rather than tidiness: the register spells a date
 * bound `?from=YYYY-MM-DD` (`transactions/page.tsx`), while `/rules` spells a
 * source transaction `?from=<txnId>` (O.13b). Merging the two namespaces would
 * make one silently overwrite the other — a rule builder prefilled from a date,
 * or a return trip filtered to a transaction id. One opaque param keeps the two
 * vocabularies apart.
 */
export const RETURN_PARAM = 'back';

/**
 * The register's own filter params — the ONLY keys that survive a round trip.
 *
 * This list is the security boundary AND the correctness boundary, so it is
 * pinned here beside `REGISTER_PATH` rather than derived: `transactions/page.tsx`
 * reads exactly these ten and treats every unknown value as "no filter", so a
 * key that is not on this list could not narrow the destination even if it were
 * carried. Anything else the caller happens to be holding is dropped.
 */
const REGISTER_VIEW_PARAMS = [
  'q',
  'account',
  'category',
  'merchant',
  'type',
  'from',
  'to',
  'unclassified',
  'reimb',
  'page',
] as const;

/** Where the reader came from, and what that view may honestly be called. */
export interface RegisterReturn {
  /** Always rooted at `REGISTER_PATH` — never a caller-supplied path. */
  href: string;
  /** Names the view, for "Back to <label>". Never guesses. */
  label: string;
}

/**
 * The `?type=` vocabulary, owned here and imported by the register.
 *
 * It was a local `const VALID_TYPES` inside `transactions/page.tsx` until O.16
 * needed the same list to decide whether a carried value is real. Two copies of
 * a vocabulary is how the register comes to accept a value this builder drops —
 * so there is one author, and adding a flow type breaks in one place.
 */
export const VALID_FLOW_TYPES: FlowType[] = ['all', 'income', 'expense', 'transfer'];

/**
 * Does this value mean anything to the register?
 *
 * Keys alone are not enough. `transactions/page.tsx` reads a CLOSED vocabulary
 * for four of the ten params and silently falls back to "no filter" on anything
 * else, so a carried `reimb=bogus` would rebuild a URL that lands on the
 * UNFILTERED register while `labelFor` went on calling it a filtered view — a
 * sentence about the reader's own history that the destination contradicts.
 * Validating here keeps the label and the landing in agreement.
 *
 * The six free-text params (`q`, `account`, `category`, `merchant`, `from`,
 * `to`) are deliberately NOT validated: an id's existence is a database
 * question a pure builder cannot ask, and the register already renders an
 * unmatched id as an empty list rather than an error. That gap is the same one
 * `merchantRegisterHref` records above, not a new one.
 */
function isMeaningfulValue(key: (typeof REGISTER_VIEW_PARAMS)[number], value: string): boolean {
  switch (key) {
    case 'type':
      return (VALID_FLOW_TYPES as string[]).includes(value);
    case 'unclassified':
      return value === '1';
    case 'reimb':
      return value === 'awaiting' || value === 'received';
    case 'page':
      return /^\d+$/.test(value) && Number(value) >= 1;
    default:
      return true;
  }
}

/**
 * Keep only the register's own params, in the register's own order.
 *
 * Empty values are dropped because the register itself treats `?q=` as no
 * filter, and carrying them back would produce a URL that differs from the one
 * the reader was actually looking at while describing the same view.
 */
function pickRegisterParams(query: string): URLSearchParams {
  const source = new URLSearchParams(query);
  const kept = new URLSearchParams();
  for (const key of REGISTER_VIEW_PARAMS) {
    const value = source.get(key);
    if (value !== null && value !== '' && isMeaningfulValue(key, value)) kept.set(key, value);
  }
  return kept;
}

/**
 * Attach the reader's current place to a link that LEAVES the register.
 *
 * Returns `href` unchanged when there is nothing worth carrying, which is the
 * whole no-false-claim rule in one line: an unfiltered register on page 1 is
 * where "Back to transactions" already lands, so the destination keeps its
 * existing copy rather than growing an affordance that promises a return to a
 * view the reader never narrowed.
 *
 * Fragments are re-attached last, not appended over. `renameHref` is
 * `/rules?from=<id>#kw-rename` (`txn-action-menu.tsx`), and a param pasted onto
 * the end of that lands INSIDE the fragment — the rules page would see no
 * return context and the browser would look for an anchor that does not exist.
 */
export function withRegisterReturn(href: string, currentQuery: string | null | undefined): string {
  if (!currentQuery) return href;
  const carried = pickRegisterParams(currentQuery);
  const encoded = carried.toString();
  if (!encoded) return href;

  const hashAt = href.indexOf('#');
  const base = hashAt === -1 ? href : href.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : href.slice(hashAt);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${RETURN_PARAM}=${encodeURIComponent(encoded)}${fragment}`;
}

/**
 * Name the view the carried params describe.
 *
 * A named filter is used ONLY when it is the sole axis in play, because
 * "Needs a category" printed over a view that is also narrowed to one merchant
 * and one month describes a bigger set than the reader will actually land on.
 * `page` is excluded from that test on purpose: it is a position WITHIN a view,
 * not another axis, so page 3 of the needs-a-category queue is still the
 * needs-a-category queue.
 *
 * Everything unnamed falls back to a phrase that is true of every filtered
 * register, rather than to a guess assembled from param names the reader has
 * never seen.
 */
function labelFor(params: URLSearchParams): string {
  const axes = REGISTER_VIEW_PARAMS.filter((key) => key !== 'page' && params.has(key));
  if (axes.length === 1) {
    if (params.get('unclassified') === '1') return 'Needs a category';
    if (params.get('reimb') === 'awaiting') return 'Awaiting reimbursement';
    if (params.get('reimb') === 'received') return 'Reimbursement received';
  }
  // Deep in an unfiltered register (page 7 of everything) is still a place worth
  // returning to, but calling it "filtered" would be a claim about a narrowing
  // the reader never made — the same over-claim the single-axis rule above
  // avoids, one step further down.
  if (axes.length === 0) return 'your activity list';
  return 'your filtered activity';
}

/**
 * Rebuild the return trip from an untrusted parameter.
 *
 * There is no redirect target to sanitise here, which is the point: the path is
 * the `REGISTER_PATH` literal and only the query is taken from the caller, so an
 * `?back=https://evil.example` or `?back=//evil.example` cannot express itself
 * as a destination — it is parsed as a query string, matches none of the ten
 * register keys, and decodes to `null`. The open-redirect class is closed by
 * construction rather than by a validator someone must remember to call, which
 * is the fence-by-construction rule this repo already applies to demo-fenced
 * capabilities.
 *
 * `null` means "say nothing": an absent, malformed, or wholly-unrecognised value
 * leaves the destination page rendering the copy it had before this slice.
 */
export function decodeRegisterReturn(raw: string | null | undefined): RegisterReturn | null {
  if (!raw) return null;
  const carried = pickRegisterParams(raw);
  const query = carried.toString();
  if (!query) return null;
  return { href: `${REGISTER_PATH}?${query}`, label: labelFor(carried) };
}
