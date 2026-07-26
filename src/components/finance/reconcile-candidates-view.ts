/**
 * reconcile-candidates-view.ts — every string and every display decision the
 * "Continue an account you already had" card and its ambiguity sibling render (TASKS L.9).
 *
 * PURE and framework-free so it is unit-testable in the node env (the repo has no RTL/jsdom;
 * vitest.config.ts sets environment:'node'). The component renders exactly these views.
 *
 * TWO owner-reported label diseases live here (2026-07-24, /accounts screenshot):
 *
 *  1. THE NUMBER IS PRINTED TWICE. Banks embed an account's number in the NAME they send
 *     ("Charles Schwab US Roth Contributory IRA ...396 (396)", "U.S. Bank Loan - 2927 (2927)",
 *     "Michael Lee - Roth IRA Brokerage Account - ****5351"), and the card then appended the
 *     providerMask qualifier — "Plaid ····5351" — so the row read "...****5351 (Plaid ····5351)".
 *     Worse, the two sides' numbers were never comparable in the first place (SimpleFIN's 396 and
 *     Plaid's 5351 are the SAME real Schwab account, owner-confirmed) — printing them side by side
 *     invited a comparison that means nothing. Each number now prints exactly once: a name that
 *     doubles its own trailing number collapses to one copy, and the qualifier drops the mask the
 *     name already carries.
 *
 *  2. THE WRONG PAIR LOOKED AS GOOD AS THE RIGHT ONE. One stale row was offered against every
 *     live account it resembled, each badged identically ("possible"). The engine now withholds
 *     a one-predecessor-several-successors match and carries it out as an ambiguity group; this
 *     module owns what the page says about it — a conclusion ("it is one of these and we cannot
 *     tell which"), never silence, and never a Combine control.
 */
import { type AmbiguousReconciliationGroup } from '@/lib/engine/account/duplicates';
import { PROVIDER_LABEL } from '@/components/finance/duplicate-card-view';

export const RECONCILE_AMBIGUITIES_TESTID = 'reconcile-ambiguities';
export const RECONCILE_AMBIGUITY_TESTID = 'reconcile-ambiguity';
export const RECONCILE_AMBIGUITY_MATCHES_TESTID = 'reconcile-ambiguity-matches';
export const RECONCILE_AMBIGUITY_HOWTO_TESTID = 'reconcile-ambiguity-howto';

export interface ReconcileSideLabel {
  /** The name to print: the feed's name with its OWN doubled trailing number collapsed to one. */
  name: string;
  /** The parenthetical qualifier: the provider label, plus the mask ONLY when the name does not
   *  already show it. Never empty — the provider is always worth stating. */
  qualifier: string;
}

/**
 * A bank that sends the same account number twice in one name — once bare/masked and once
 * parenthesized, at the very end ("IRA ...396 (396)") — is saying one thing, so the row reads it
 * once. END-anchored on purpose: "401 (401)k" mid-name is a different string ("401k"), not a
 * doubled number, and must not collapse. Three-or-more digits: Schwab's SimpleFIN identifier is
 * three (L.9), and a one/two-digit run ("Plan 12 (12)") is not an account-number shape.
 * A mismatching pair ("...396 (5351)") collapses NOTHING — two different numbers are both evidence.
 */
const DOUBLED_TRAILING_NUMBER = /(\d{3,})\s+\(\1\)$/;

/**
 * Does the name visibly carry these digits? ALL parenthesized and mask-prefixed groups are
 * checked, not the first (critic P2-1: "(2021) Roth ****5351" kept printing ····5351 because the
 * matcher's first-match helper stops at the year), and groups of THREE or more digits count —
 * Schwab's own SimpleFIN identifier in this feature's history is 3 (cycle-2 critic P2-4: a
 * 3-digit mask column printed twice). Consequences and limits, both accepted and locked: a
 * PARENTHESIZED or mask-prefixed group equal to the mask suppresses the qualifier's repeat even
 * when the name meant something else ("Roth IRA (2021)" with mask 2021 — the digits still print
 * once, just no longer labelled as the mask); a BARE digit run ("Roth IRA 5351") never
 * suppresses — a year or model number in a name must not strip the qualifier's evidence.
 */
function nameShowsDigits(name: string, digits: string): boolean {
  for (const m of name.matchAll(/\((\d{3,})\)/g)) if (m[1] === digits) return true;
  for (const m of name.matchAll(/(?:[•·*#]|\.{2,}|…)\s*(\d{3,})\b/g)) if (m[1] === digits) return true;
  return false;
}

export function reconcileSideLabel(side: {
  name: string;
  provider: string;
  mask: string | null;
  userNamed?: boolean;
}): ReconcileSideLabel {
  // The collapse repairs BANK formatting — it must never edit the name the USER chose (critic
  // P2-3: L.7's whole point is that he matches a card entry to a row by his own words; collapsing
  // his "Savings 2024 (2024)" on one card broke that match).
  const name = side.userNamed === true ? side.name : side.name.replace(DOUBLED_TRAILING_NUMBER, '$1');
  const provider = PROVIDER_LABEL[side.provider] ?? side.provider;
  // The qualifier's mask adds nothing when the name already shows those digits — print the
  // provider alone rather than "****5351 (Plaid ····5351)".
  const nameShowsMask = side.mask !== null && nameShowsDigits(side.name, side.mask);
  return { name, qualifier: nameShowsMask ? provider : `${provider}${side.mask ? ` ····${side.mask}` : ''}` };
}

/** Always rendered on the ambiguity card. States the conclusion and why nothing is offered. */
export const RECONCILE_AMBIGUITY_INTRO =
  'One of your old accounts looks like more than one of your live accounts. An old account can only continue into one live account, so we’re not offering to combine it — choosing the wrong one would fold the wrong histories together.';

export interface ReconcileAmbiguityView {
  predecessor: ReconcileSideLabel;
  successors: (ReconcileSideLabel & { id: string })[];
  /** "Looks like 2 of your live accounts:" — the count is a claim, so it is computed from the
   *  list that will actually render, never passed in. */
  matchesSentence: string;
  /** The per-group remedy, plural-safe: with 3+ successors one dismissal does not release
   *  anything (critic P1-2). It may name the "Not a duplicate" control because every pair in a
   *  RENDERED group is on the notice by construction — the server mirrors every notice filter in
   *  the engine's excludePair, and a proven pair (which fires no heuristic signal and so has no
   *  notice) is hoisted OUT of groups as an offer. The invariant is locked server-side in
   *  tests/unit/reconcile-surfaces.test.ts. */
  howto: string;
}

/** The view for one ambiguity group. */
export function reconcileAmbiguityView(group: AmbiguousReconciliationGroup): ReconcileAmbiguityView {
  const successors = group.successors.map((s) => ({ id: s.id, ...reconcileSideLabel(s) }));
  // Two successors can paint byte-identical labels (identical nicknames, or the tier-A collision
  // of two genuinely different accounts sharing bank + last-4). On the card whose whole job is
  // telling accounts apart that is the L.5 disease, so a mechanical positional suffix makes the
  // collision impossible — position is render-order, never derived from the data (unforgeable).
  const seen = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const s of successors) {
    const k = `${s.name}${s.qualifier}`;
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }
  for (const s of successors) {
    const k = `${s.name}${s.qualifier}`;
    if ((totals.get(k) ?? 0) > 1) {
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      s.qualifier = `${s.qualifier} · ${n}`;
    }
  }

  return {
    predecessor: reconcileSideLabel(group.predecessor),
    successors,
    matchesSentence: `Looks like ${successors.length} of your live accounts:`,
    howto:
      'If you know which one it is, say which it is not: on the possible-duplicate notice below, tap “Not a duplicate” for each pair that isn’t a match — when only one possible continuation remains, it appears as a Combine option in “Continue an account you already had” above.',
  };
}
