/**
 * The one shared demo account id.
 *
 * It lives here, and not in auth.config.ts, because the cron import graph must stay
 * free of NextAuth (the #220 rule) while still being able to recognize the demo user.
 * `@/auth.config` re-exports it, so every existing `DEMO_USER_ID` import is unchanged.
 *
 * Why anything needs to recognize it: the demo is a credential-free, ONE-CLICK login,
 * so every anonymous visitor is the SAME user row. Anything that accumulates a user's
 * own input and shows it back to them — a household seat (#210), a learned phrasing
 * (#225) — would therefore be showing one stranger's typed words to the next. Features
 * of that shape opt the demo user out; read-only demo data does not.
 */
export const DEMO_USER_ID = 'user-demo';

export function isDemoUser(userId: string): boolean {
  return userId === DEMO_USER_ID;
}

/**
 * Refusal shown when the shared demo account tries to connect/ingest a real bank
 * (#242 follow-up). Connecting a bank to `user-demo` would land ONE visitor's real
 * financial data in the row every other anonymous visitor sees — the same
 * shared-account leak class as the household seat (#210) and learned vocabulary
 * (#226). No-shame, states the why, points at the real fix (a free account).
 */
export const DEMO_CONNECT_BLOCKED =
  'The demo is a shared account, so it can’t connect a real bank — create your own free account to link securely.';

/**
 * Refusal shown when the shared demo account tries to TYPE or UPLOAD its own
 * figures (#243 follow-up — the typed/uploaded leg of the same rule). A manual
 * account balance, a hand-entered transaction, a pasted CSV statement, or a
 * brokerage holding entered into `user-demo` would show ONE visitor's real
 * numbers to the NEXT visitor. Editing/deleting the seeded demo data stays open —
 * it's fake, and exploring it is the point of the demo.
 */
export const DEMO_ENTRY_BLOCKED =
  'The demo is a shared account, so anything you add here would be visible to other visitors — create your own free account to enter your own data.';

/**
 * Refusal for account-destructive actions on the shared demo (#244 critic P1-3).
 * One visitor typing the delete phrase would irreversibly wipe the demo for every
 * other visitor (and brick demo sign-in until a reseed); an epoch bump would sign
 * every concurrent visitor out. The settings UI hides these controls for demo —
 * this message is the server-side defense in depth.
 */
export const DEMO_DESTROY_BLOCKED =
  'The demo is a shared account, so it can’t be deleted or signed out everywhere — create your own free account to control your own data.';

/**
 * Refusal when the shared demo account tries to REMOVE a built-in category (O.17c).
 *
 * Different in kind from the leaks above: a `HiddenCategory` row stores a static
 * category slug, never a word the visitor typed, so nothing of one visitor's
 * vocabulary reaches the next. The harm is the other shared-row failure mode —
 * one anonymous visitor taking categories out of the pickers that every visitor
 * after them chooses from. The Settings copy used to invite exactly that on the
 * demo row ("Remove the ones you don't use"), one tap from a visible button.
 *
 * Only the REMOVING direction is fenced. Restoring can only ever move the demo
 * back toward its seeded default — the seed writes no `HiddenCategory` rows, so
 * with removal fenced there is nothing on the demo row to restore, and leaving it
 * open keeps an in-app remedy if a row ever arrives by some other route. That
 * premise is a fact about the seed, so it is locked by a test rather than left in
 * this comment (the same one-sided shape as `resetSystemCategoryName` and
 * `deleteCustomCategory`, whose comments state the premise but do not assert it).
 */
export const DEMO_CATEGORY_REMOVE_BLOCKED =
  'The demo is a shared account, so removing a category would take it out of the pickers for every other visitor — create your own free account to set up the categories you use.';

/**
 * Refusal for cross-provider account reconciliation on the shared demo (TASKS 4.6).
 * Demo accounts are `provider: 'demo'` and are excluded from the #192 duplicate
 * detector, so a reconciliation candidate is never PROPOSED for the demo — this is
 * server-side defense in depth against a crafted confirm request, matching the other
 * demo fences. Reconciling would zero one demo balance and re-window its transactions
 * for every visitor sharing the row.
 */
export const DEMO_RECONCILE_BLOCKED =
  'The demo is a shared account, so its accounts can’t be linked or reconciled — create your own free account to manage your real accounts.';
