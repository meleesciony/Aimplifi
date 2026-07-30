/**
 * Query-param names shared by the transaction detail PAGE (a server component)
 * and its client view.
 *
 * A plain module on purpose. This constant lived in the `'use client'` view for
 * one cycle, and every export of a client module becomes a client-reference stub
 * on the server side of the RSC graph — so the page's `query[UNCONFIRMED_PARAM]`
 * indexed searchParams with a non-string and could never match. The banner it
 * gates therefore never rendered, which made a whole fix inert while typechecking
 * and building cleanly (critic cycle 2, F1; proved by an A/B build where the only
 * change was inlining the literal).
 *
 * The same shape as the `'use server'` rule in docs/lessons/mutation-form-recipe.md
 * (L.7), from the other direction: a value shared across the server/client
 * boundary belongs in a module that declares neither.
 */

/** Set when a write outran its deadline, so the reload that follows can say so. */
export const UNCONFIRMED_PARAM = 'unconfirmed';
