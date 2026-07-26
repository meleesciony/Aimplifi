/**
 * display-name.ts — the user's own name for an account, and the one rule for when it wins.
 *
 * TASKS L.7 (owner-requested 2026-07-24: *"there should be a way to edit name of accounts
 * myself"*). Three cards arrive from the feed named `CREDIT CARD` and two named `Venture`;
 * no heuristic can improve that data, but the person who owns the accounts can, in five
 * seconds. `Account.displayName` holds what he types. The provider ingests write `name` and
 * only `name`, so a nickname survives every sync — that is the whole point of the second
 * column (a plain overwrite of `name` is reverted by the next cron).
 *
 * The direction of the default is deliberate and load-bearing:
 *
 *   `name` (the feed's own string) stays the value every module reads unless it explicitly
 *   asks for the label. So a display site that nobody remembered to update shows the bank's
 *   name — stale, not wrong — while a MATCHING site that nobody remembered to update keeps
 *   comparing the strings the bank sent, which is the only comparison that means anything.
 *   Nicknames must never reach duplicate detection, reconciliation matching, or the
 *   account-identity tokenizer: two cards are the same card because of what the bank says,
 *   never because of what their owner called them.
 *
 * So there are exactly two ways to read a name, and the second one has no helper on purpose:
 *   - `accountLabel(a)` — anything a reader reads.
 *   - `a.name`, read directly — every comparison, every sort a decision depends on, and every
 *     surface belonging to someone other than the row's owner.
 *
 * Two earlier helpers were removed rather than left as API. `accountEvidenceLabel` appended
 * `(your bank calls this "X")` to identity-card labels: it stacked parentheticals inside
 * prompts and aria labels, asserted a bank for MANUAL rows that have none, and attributed to
 * the bank a SimpleFIN string this app composes itself. `accountSearchNames` let Ask match a
 * nickname too — correct in principle, but the branch it feeds sums every match without
 * separating assets from liabilities, so a second short user-chosen string could turn one right
 * answer into a total that adds money owed to money held. Both are recorded in STATUS as
 * follow-ups with the prerequisite each one needs first.
 */

import { UNNAMED_ACCOUNT, renderSafe, sanitizeName } from './render-safe';

/** Longest nickname we store, counted in code points so an emoji costs one, not two. */
export const MAX_NICKNAME_LENGTH = 60;

export const NICKNAME_TOO_LONG = `Keep the name to ${MAX_NICKNAME_LENGTH} characters or fewer.`;

/** Anything carrying a feed name and (optionally) the user's own name for it. */
export interface NameableAccount {
  readonly name: string;
  readonly displayName?: string | null;
}

/**
 * What a reader sees: the user's nickname when he set one, the feed's name otherwise.
 * Both routes go through `renderSafe`, so the painted string equals the compared string
 * (bidi overrides and zero-width characters are stripped once, here).
 */
export function accountLabel(a: NameableAccount): string {
  const nickname = a.displayName == null ? '' : sanitizeName(a.displayName);
  return nickname === '' ? renderSafe(a.name) : nickname;
}

/**
 * What the rename refuses with when the row is gone. It lives here rather than beside the
 * action because a `'use server'` module may export nothing but async functions — exporting
 * this string from there made Next drop EVERY export in the file, including the action, and
 * the build failed with "the module has no exports at all".
 */
export const ACCOUNT_NOT_FOUND = 'That account is no longer here.';

export type NicknameParse = { readonly ok: true; readonly value: string | null } | { readonly ok: false; readonly error: string };

/**
 * Validate what the user typed. An empty box is not an error — it is the instruction
 * "go back to my bank's name", and it stores null. A name that is nothing but invisible
 * characters sanitizes to empty and means the same thing, so it clears too rather than
 * storing a row whose label would render as `Unnamed account` on every surface.
 */
export function parseAccountNickname(raw: string): NicknameParse {
  const cleaned = sanitizeName(raw);
  if (cleaned === '') return { ok: true, value: null };
  if ([...cleaned].length > MAX_NICKNAME_LENGTH) return { ok: false, error: NICKNAME_TOO_LONG };
  return { ok: true, value: cleaned };
}

/** Re-exported so callers of this module never need to reach past it for the empty-name face. */
export { UNNAMED_ACCOUNT };
