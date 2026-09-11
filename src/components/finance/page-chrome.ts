/**
 * Shared page chrome for the M.4 beauty pass (DECISIONS #724).
 *
 * The gap was a type scale and spacing rhythm, not colour infrastructure.
 * These tokens are the one place page titles, leads, and vertical stacks
 * evolve — so /accounts does not drift from /coach the way `text-xl` vs
 * `text-2xl tracking-tight` already had.
 *
 * Deliberately NOT applied to money figures, payee headings, or card
 * titles. A page title and a dollar amount are different jobs; folding
 * them together would let a restyle change how a figure reads.
 */
export const PAGE_TITLE_CLASS = 'text-2xl font-semibold tracking-tight sm:text-3xl';

/**
 * The lead's column cap is a ceiling, not a set width: routes whose whole
 * column is narrower than 2xl (max-w-md forms, the error page) must not
 * have a lead that overreaches its own container, so the token caps at md
 * and the wide routes re-open the column explicitly.
 */
export const PAGE_LEAD_CLASS = 'mt-1 max-w-md text-sm leading-relaxed text-muted-foreground';

/** Re-open the lead's column on wide routes (pairs with PAGE_LEAD_CLASS). */
export const PAGE_LEAD_WIDE_CLASS = 'sm:max-w-2xl';

export const PAGE_STACK_CLASS = 'space-y-5 sm:space-y-6';

export const PAGE_SECTION_LABEL_CLASS =
  'flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground';
