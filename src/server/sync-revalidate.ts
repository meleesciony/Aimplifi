/**
 * The routes a bank sync invalidates, in ONE list (L.28).
 *
 * There were THREE lists — `syncPlaidNow` (5 paths), `syncSimplefinNow` (7) and
 * `linkPlaidAccount` (4, and the last one found, 270 lines above the first in the same
 * file) — and they had drifted: the Plaid sync path never revalidated `/calendar` or
 * `/coach`, and NONE of the three revalidated `/spending-plan`, whose guilt-free
 * breakdown is summed from the detected scheduled projections that
 * `refreshRecurringForUser` replaces at the tail of every sync. `linkPlaidAccount` is
 * the one moment a user goes from zero of those projections to N, and it had the
 * shortest list of the three.
 *
 * SCOPE, stated because it would be easy to over-read: this consolidation is hygiene,
 * NOT the fix for the owner's stale $0.00. Every route here is authenticated and
 * dynamic (each calls `auth()`; none sets `export const dynamic`/`revalidate`), so a
 * missing entry could not by itself have produced a stale render on a full page load.
 * The re-render fix is the `changed` signal reaching `router.refresh()`. What a
 * drifted list DOES cost is a soft navigation landing on a cached route segment, and
 * three lists that disagree is a defect regardless of which symptom it produced.
 *
 * This is EVERY authenticated route under `src/app/(app)`, not a judgement about
 * which pages a sync happens to touch. The first draft did make that judgement and
 * got it wrong twice in a row: `/settings` was left out as "nothing a sync writes"
 * while rendering the eligible-account list for the payment-account selector plus
 * live transaction and statement COUNTS, and `/trust` was left out while rendering a
 * categorization-accuracy sample that ingested rows feed. The two errors are the same
 * error this whole slice exists to fix — an enumeration that has to be remembered —
 * so the enumeration is now mechanical and `sync-revalidate.test.ts` fails if a route
 * is added to the app without landing here.
 *
 * Over-including is close to free: every one of these renders per-user and dynamic, so
 * a redundant entry costs a cache mark. Under-including costs a reader a stale money
 * figure, which is the failure this file was created to stop.
 *
 * A plain leaf module, not an export from either action file, because a `'use server'`
 * file may export only async functions — one exported constant there makes `next build`
 * report that the action "was not found" long after tsc, eslint and vitest are green
 * (docs/lessons/mutation-form-recipe.md, L.7).
 */
import { revalidatePath } from 'next/cache';

export const SYNC_REVALIDATE_PATHS = [
  '/accounts',
  '/ask',
  '/budgets',
  '/calendar',
  '/cards',
  '/coach',
  '/dashboard',
  '/forecast',
  '/goals',
  '/investments',
  '/recurring',
  '/reports',
  '/rules',
  '/settings',
  '/spending-plan',
  '/transactions',
  // The app's first DYNAMIC route (O.13b, the transaction detail view). It is
  // marked through the type-aware form below: `revalidatePath('/x/[id]')` with a
  // bare string marks NOTHING, so an entry here without that branch would look
  // like coverage and do no work — exactly the trap the sibling test was left
  // here to catch, and it caught it.
  '/transactions/[id]',
  '/transactions/import',
  '/transactions/new',
  '/trends',
  '/triage',
  '/trust',
] as const;

/** Is this entry a dynamic route (`/x/[id]`) rather than a literal path? */
export function isDynamicRoutePath(path: string): boolean {
  return path.includes('[');
}

/**
 * Mark every sync-affected route stale. Safe to call from a server action.
 *
 * A dynamic route MUST pass the second `'page'` argument: given a path
 * containing a `[param]`, Next treats the bare one-argument call as a literal
 * URL, which matches no rendered page and marks nothing.
 *
 * SCOPE, corrected after a critic pass and stated rather than overclaimed: the
 * detail route calls `auth()`, so `next build` lists it as ƒ (Dynamic) and it has
 * no Full Route Cache entry to go stale — this entry cannot today be the
 * difference between fresh and pre-sync money, and saying it was would be the
 * same overstatement this file's own test exists to prevent. What the branch
 * buys is that the list means what it says: every authenticated route is marked,
 * by a call that actually marks it, so the enumeration stays mechanical if the
 * route's caching ever changes.
 */
export function revalidateAfterSync(): void {
  for (const p of SYNC_REVALIDATE_PATHS) {
    if (isDynamicRoutePath(p)) revalidatePath(p, 'page');
    else revalidatePath(p);
  }
}
