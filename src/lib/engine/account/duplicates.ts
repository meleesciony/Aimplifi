/**
 * Cross-provider duplicate-account detection (TASKS Wave 1 — DECISIONS #192).
 *
 * The app has NO cross-provider dedup: Plaid, SimpleFIN, and manual entry each mint
 * their own `Account` row for the same real bank, keyed by their own provider id, and
 * transaction dedup is `@@unique([accountId, providerRef])` — scoped to one account and
 * one provider's id scheme. So the SAME real account connected through two providers is
 * stored twice and its balance/transactions double-count in net worth, spending, and
 * cash-needed (verified against the ingest + netWorthSeries paths). This engine is a pure,
 * deterministic, ADVISORY detector that flags likely-same accounts so the UI can warn the
 * user. It never deletes or merges anything — the fix (disconnect one side) stays the
 * user's explicit choice.
 *
 * Pure: no React, no DB, no `new Date()`, no model calls. Deterministic output ordering.
 *
 * Matching is necessarily heuristic because SimpleFIN carries no account mask (last-4), so
 * an exact identity key across providers does not exist. To keep false positives low, a
 * pair is flagged only when it is cross-provider, same account `type`, same `currency`, AND
 * at least one positive signal fires (shared last-4, identical non-zero balance, or a shared
 * distinctive name token). `demo`/seed rows are never compared.
 */

import { compareAccountIdentity, type IdentityAccount } from '@/lib/engine/account/identity';
import { registrationsConflict } from '@/lib/engine/account/registration';

export interface DuplicateAccountCandidate {
  id: string;
  provider: string; // 'plaid' | 'simplefin' | 'manual' | 'demo' | …
  name: string;
  type: string; // CHECKING | SAVINGS | CREDIT | INVESTMENT | LOAN
  mask: string | null; // last-4 (Plaid populates; SimpleFIN/manual usually null)
  currentBalanceCents: number;
  currency: string | null; // ISO-4217; null assumed USD
  /** The owning PlaidItem, when provider === 'plaid' (slice-6 critic C-10): the per-item
   *  providerRef scheme means the SAME bank re-linked through a NEW item mints new rows, so
   *  two plaid accounts from DIFFERENT items can be the same real account. Optional —
   *  callers that omit it keep the blanket same-provider skip. */
  plaidItemId?: string | null;
  /** The provider's raw subtype ('roth', 'ira', 'checking', …), when it wrote one — Plaid does,
   *  SimpleFIN and manual rows never do (TASKS L.9). Read ONLY by the registration veto below,
   *  which also reads the name, so a caller that omits this keeps the veto working on names. */
  subtype?: string | null;
}

export interface DuplicateAccountRef {
  id: string;
  name: string;
  provider: string;
  mask: string | null;
  /** True when `name` is the USER'S chosen nickname, not the feed's string (TASKS L.7/L.9).
   *  Display rules that repair bank formatting (the doubled-number collapse in
   *  reconcile-candidates-view.ts) must never edit the name the user chose — L.7's whole point
   *  is that he matches a card entry to a row by his own words. Optional: engine-constructed
   *  refs leave it unset; the server attaches it when it maps display names. */
  userNamed?: boolean;
}

export type DuplicateConfidence = 'high' | 'medium';

/** The strongest positive signal that fired for a pair (persistent > mask > balance > name).
 *  `persistent` is only ever produced by the identity ladder (identity.ts tier P — the bank's own
 *  cross-Item account id); this heuristic detector never emits it. */
export type ReconciliationMatchSignal = 'persistent' | 'mask' | 'balance' | 'name';

export interface SuspectedDuplicatePair {
  a: DuplicateAccountRef;
  b: DuplicateAccountRef;
  confidence: DuplicateConfidence;
  /** Human-readable signals that fired, e.g. `same last-4 (1234)`. */
  reasons: string[];
}

/** Providers whose rows are seed/fixture data and never user-linked → never compared. */
const EXCLUDED_PROVIDERS = new Set(['demo']);

/**
 * Generic words that carry no institution identity — stripped before name-token overlap so
 * two unrelated "… Checking" accounts don't match on the word "checking".
 */
const NAME_STOPWORDS = new Set([
  'account',
  'accounts',
  'bank',
  'banking',
  'card',
  'cards',
  'cash',
  'checking',
  'credit',
  'debit',
  'demo',
  'deposit',
  'joint',
  'llc',
  'loan',
  'money',
  'my',
  'personal',
  'plaid',
  'plus',
  'primary',
  'savings',
  'simplefin',
  'the',
  'and',
  'for',
  'of',
]);

function normalizeCurrency(c: string | null): string {
  return (c ?? 'USD').toUpperCase();
}

/**
 * A last-4 read from an account NAME, for feeds with no mask column that embed the number in the
 * name (SimpleFIN: "U.S. Bank Loan - 2927 (2927)", "Truist Mortgage 1192 (1192)"). Conservative:
 * only a PARENTHESIZED or MASK-PREFIXED 4-digit group, never a bare 4-digit run.
 *
 * DIRECTION IS THE WHOLE POINT (critic F3, owner-reported 2026-07-24): this is used ONLY as a
 * POSITIVE, confirming signal — one side's real mask column matching the other side's name-embedded
 * number is strong evidence of the SAME account. It is NEVER used to veto. A mis-read (a
 * parenthesized YEAR like "Roth IRA (2021)") can then only ever SURFACE a dismissable pair; used as
 * a veto the same mis-read would SILENTLY HIDE a real duplicate and let a balance double-count,
 * which is why #292 removed it from the veto path. Positive = safe, negative = dangerous.
 */
export function maskFromName(name: string): string | null {
  const paren = /\((\d{4})\)/.exec(name);
  if (paren) return paren[1];
  // No 'x' here on purpose: the x in "Amex 2019" over-matched a year (critic F2).
  const masked = /(?:[•·*#]|\.{2,}|…)\s*(\d{4})\b/.exec(name);
  return masked ? masked[1] : null;
}

/** The account's last-4 for POSITIVE matching: the mask column, else one embedded in the name. */
function matchableMask(a: { mask: string | null; name: string }): string | null {
  return a.mask ?? maskFromName(a.name);
}

/**
 * Every account NUMBER a row advertises — the mask column, plus any group a feed renders the way
 * an account number is rendered: parenthesized ("… (4034)") or behind a truncation prefix
 * ("…383", "····4034", "Schwab 529 Plan ...-01"). Two digits minimum, because SimpleFIN truncates
 * to as few as two ("-01"), and `maskFromName` deliberately reads only FOUR — which is why the
 * old veto was blind to exactly the rows this exists for.
 *
 * Deliberately NOT a bare `\d{3,}` sweep of the name: that reads "529" out of "Schwab 529 Plan"
 * and "401" out of "401k" — product names, not account numbers. On the owner's corpus the sweep
 * happens to reach the same verdicts (measured: both catch 9 of 9), and a rule that is right by
 * accident is a rule that breaks silently the first time someone opens a "529 Plan" at a bank
 * whose mask really is 529.
 */
export function advertisedAccountNumbers(a: { mask: string | null; name: string }): string[] {
  const out = new Set<string>();
  if (a.mask) out.add(a.mask);
  for (const m of a.name.matchAll(/\((\d{2,})\)/g)) if (!looksLikeYear(m[1])) out.add(m[1]);
  // `\s*` mirrors `maskFromName`: "•••• 1234" with a space is the commonest rendering of a mask in
  // a display name, and the first draft of this function was blind to exactly it while the
  // POSITIVE parser next to it was not — two parsers of one field that disagree (critic P1-6).
  for (const m of a.name.matchAll(/(?:[•·*#]|\.{2,}|…)-?\s*(\d{2,})\b/g)) if (!looksLikeYear(m[1])) out.add(m[1]);
  return [...out];
}

/**
 * A four-digit group in the plausible-year range, which a bank-composed name uses for something
 * that is NOT an account number far more often than for one: "Roth IRA (2021)", "Kids College
 * (2035)", "CD 12-month (2025)", "…2019 Contributions".
 *
 * This is the misread #292 and dup-veto critics F1/F2 named, and the reason a name-parsed number
 * may never gate what the app offers. Excluding the range costs almost nothing here — a real last-4
 * lands in 1900-2099 about 2% of the time, and losing it only makes this evidence ABSTAIN.
 */
function looksLikeYear(digits: string): boolean {
  if (digits.length !== 4) return false;
  const n = Number(digits);
  return n >= 1900 && n <= 2099;
}

/**
 * True when both rows advertise an account number and NONE of them correspond.
 *
 * Correspondence is SUFFIX, never equality: providers truncate the same account to different
 * lengths, so Schwab's "…383" and Plaid's mask "7383" are the same account. Equality here would
 * condemn a genuine pair — measured on the owner's data at $898,889.99 before it was caught.
 *
 * One side with nothing to advertise is an ABSENCE, never a difference (the doctrine
 * `registrationsConflict` states two functions up, and the reason #292 pulled a name-parsed
 * last-4 off the general veto path).
 */
export function accountNumbersConflict(
  lo: { mask: string | null; name: string },
  hi: { mask: string | null; name: string },
): boolean {
  const a = advertisedAccountNumbers(lo);
  const b = advertisedAccountNumbers(hi);
  if (a.length === 0 || b.length === 0) return false;
  // Suffix AND prefix. Suffix alone was wrong in a way this app CAUSES: `mapSimplefinAccount`
  // stores `(org + ' ' + name).slice(0, 80)`, and SimpleFIN renders the number at the END, so a
  // long institution name truncates "…3075" to "…30" — a PREFIX, which under a suffix-only rule
  // conflicts with the very account it came from (critic P1-4, executed through the real mapper).
  // Being generous here only ever makes this evidence abstain, which is the direction it must fail.
  const corresponds = (x: string, y: string) =>
    x === y || x.endsWith(y) || y.endsWith(x) || x.startsWith(y) || y.startsWith(x);
  return !a.some((x) => b.some((y) => corresponds(x, y)));
}

/** Distinctive lowercase name tokens (institution-ish), stopwords / numbers / 1-char removed. */
export function distinctiveNameTokens(name: string): Set<string> {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2 && !NAME_STOPWORDS.has(t) && !/^\d+$/.test(t));
  return new Set(tokens);
}

function sharedTokens(a: string, b: string): string[] {
  const tb = distinctiveNameTokens(b);
  return [...distinctiveNameTokens(a)].filter((t) => tb.has(t)).sort();
}

/** Stable order for a candidate: provider, then name, then id — so pair (a,b) is deterministic. */
function order(x: DuplicateAccountCandidate, y: DuplicateAccountCandidate): number {
  return x.provider.localeCompare(y.provider) || x.name.localeCompare(y.name) || x.id.localeCompare(y.id);
}

function toRef(c: DuplicateAccountCandidate): DuplicateAccountRef {
  return { id: c.id, name: c.name, provider: c.provider, mask: c.mask };
}

/**
 * The heuristic core, shared by the personal and household detectors: hard
 * prerequisites (same type, same currency, no seed rows) plus at least one
 * positive signal. Returns null when the pair is not a suspected duplicate.
 */
function duplicateSignals(
  lo: DuplicateAccountCandidate,
  hi: DuplicateAccountCandidate,
): { confidence: DuplicateConfidence; reasons: string[]; signal: ReconciliationMatchSignal } | null {
  if (EXCLUDED_PROVIDERS.has(lo.provider) || EXCLUDED_PROVIDERS.has(hi.provider)) return null;
  // A genuine duplicate is the same account: same type and same currency are hard prerequisites.
  if (lo.type !== hi.type) return null;
  if (normalizeCurrency(lo.currency) !== normalizeCurrency(hi.currency)) return null;
  // A Roth is never a Traditional, whatever their names, balances or numbers agree on (TASKS L.9,
  // owner-reported: one SimpleFIN Roth IRA was offered against BOTH a Plaid Roth and a Plaid
  // Traditional, at the same badge). This is the one veto that survives the provider boundary a
  // last-4 cannot cross — a mask is an identifier convention, a registration is a fact about the
  // account — and it is scoped hard so its misfire direction (hiding a real duplicate, #292)
  // stays closed: INVESTMENT rows only, both sides must resolve, and evidence of a Roth always
  // beats an unspecialised subtype. See engine/account/registration.ts for the whole argument.
  if (registrationsConflict(lo, hi)) return null;
  // A different last-4 means different CARDS — but NOT necessarily different ACCOUNTS: one account
  // can carry several cards (an authorized-user card for a spouse) with different numbers yet ONE
  // shared balance. So a differing last-4 disqualifies only the WEAK name signal (a shared surname
  // or product line — "lee", "venture" — is common across a household's separate cards); it must NOT
  // suppress the strong IDENTICAL-NON-ZERO-BALANCE signal, which still points at one real account
  // seen through two connections. Owner-confirmed 2026-07-24: his + spouse's Ventures (different
  // last-4, DIFFERENT balances, matched only on the name) stay hidden; his Chase E.LEE(4034) + wife's
  // M.LEE ····4927 (different last-4 but IDENTICAL balance — likely his account + her authorized card)
  // stays SURFACED so he can Combine or dismiss it. Uses the mask COLUMN only — parsing a last-4 out
  // of a NAME mis-reads a parenthesized year ("Roth IRA (2021)") or the x in "Amex" and would wrongly
  // suppress a genuine duplicate (dup-veto critic F1/F2, the silent-double-count direction).
  //
  // U.14, 2026-08-12: the mask COLUMN is why this veto never fired on the migration it exists for.
  // SimpleFIN populates no mask, so `!!lo.mask && !!hi.mask` is false for every SimpleFIN→Plaid
  // pair, and the weak name signal ran unchecked across exactly those rows. MEASURED on the owner's
  // production data: it proposed three distinct Schwab 529 plans against one Vanguard 401k on the
  // single shared token "plan", and two different cardholders' cards on "lee" — and nine such pairs
  // had already been confirmed, each asserting an identity between accounts that are not the same.
  // `accountNumbersConflict` reads the number a feed ADVERTISES (mask column, parenthesized, or
  // behind a truncation prefix) and corresponds them by suffix.
  //
  // F1/F2's argument is respected, not overturned: they refused a name-parsed last-4 on the GENERAL
  // veto path, where a mis-read hides a real duplicate and money silently doubles. This stays where
  // `masksDiffer` already stood — gating the WEAK NAME signal alone. A pair that matches on mask or
  // on an identical non-zero balance is untouched, so the owner-confirmed Chase E.LEE/M.LEE case
  // still surfaces on the strength that justified it. Measured both directions before shipping
  // (`scripts/audit-probes/u11k-which-veto-catches-which.mts`): 9 of 9 wrong pairs caught, and 0 of
  // the 8 links independently judged genuine suppressed.
  //
  // U.14 REVERTED 2026-08-12, same session it shipped. Widening this to read the number out of the
  // NAME was wrong twice over, and both were PROVEN rather than argued:
  //   (a) it reintroduced exactly the direction #292/F1/F2 removed, and worse — the new parser read
  //       TWO digits where `maskFromName` reads four, so `Roth IRA (2021)` yields "2021" and a
  //       genuine duplicate against a real mask stopped being flagged at all. A hidden duplicate is
  //       a silent double-count, which is the failure direction this file exists to avoid.
  //   (b) the boolean's scope was NOT the whole story. `duplicateSignals` also feeds
  //       `detectReconciliationCandidates`, where suppressing ONE candidate collapses a withheld
  //       L.9 ambiguity ("it is one of these and we cannot tell which") into `list.length === 1` —
  //       which renders a one-click Combine for the survivor. Confirming that zeroes a balance.
  //       `tests/e2e/reconcile.spec.ts` "a Roth is never a Traditional … the right one offered"
  //       caught it in CI (run 31627590689); the local gate skips e2e, which is why it shipped.
  // The evidence the widening was built on is still good and still measured — it just belongs on an
  // ADVISORY surface, not on a gate that decides what the app offers. It now lives in the U.15 link
  // audit (`src/lib/engine/account/link-audit.ts`), where the worst case is a visible sentence next
  // to an Undo the user already had, rather than a hidden change to what counts.
  const masksDiffer = !!lo.mask && !!hi.mask && lo.mask !== hi.mask;

  const reasons: string[] = [];
  let confidence: DuplicateConfidence | null = null;

  // POSITIVE last-4 match. Uses the mask column OR a last-4 embedded in the name, so a SimpleFIN
  // row that carries no mask column ("U.S. Bank Loan - 2927 (2927)") still confirms against the
  // live Plaid mask (2927) — owner-reported 2026-07-24: that pair was double-counting $23.8K and
  // NOTHING flagged it, because its name reduces to no distinctive token ("bank"/"loan" are
  // stopwords, "2927" is numeric) and its balances differ by $8.77. Positive-only (see maskFromName).
  const loMatchMask = matchableMask(lo);
  const hiMatchMask = matchableMask(hi);
  const maskMatch = !!loMatchMask && !!hiMatchMask && loMatchMask === hiMatchMask;
  if (maskMatch) {
    reasons.push(`same last-4 (${loMatchMask})`);
    confidence = 'high';
  }

  // Identical non-zero balance is a strong same-account signal (zero excluded — many empty accounts
  // share 0). It SURVIVES a differing last-4: two cards on one account share one balance.
  const balanceMatch = lo.currentBalanceCents === hi.currentBalanceCents && lo.currentBalanceCents !== 0;
  if (balanceMatch) {
    reasons.push('identical balance');
    confidence = 'high';
  }

  // The name is the WEAK signal, and a differing last-4 disqualifies it — different cards that merely
  // share a surname / product line are not the same account on the strength of the name alone.
  const shared = sharedTokens(lo.name, hi.name);
  if (shared.length > 0 && !masksDiffer) {
    reasons.push(`shared name: ${shared.map((t) => `“${t}”`).join(', ')}`);
    if (confidence === null) confidence = 'medium';
  }

  if (confidence === null) return null;
  // Primary signal = the strongest that fired. mask (identity) > balance > name; derived from the
  // SAME booleans that built `reasons`, never re-parsed (docs/lessons/a-guard-must-read-what-it-guards).
  const signal: ReconciliationMatchSignal = maskMatch ? 'mask' : balanceMatch ? 'balance' : 'name';
  return { confidence, reasons, signal };
}

/**
 * Evaluate one ordered pair. Returns a flagged pair, or null when the two accounts are not a
 * suspected duplicate. Assumes `lo` and `hi` are already in `order()` order.
 */
function evaluatePair(
  lo: DuplicateAccountCandidate,
  hi: DuplicateAccountCandidate,
): SuspectedDuplicatePair | null {
  // Same-provider ingest dedups per (accountId, providerRef) — within ONE connection. That
  // skip stays for simplefin (one connection per user) and manual rows, but two plaid rows
  // from DIFFERENT PlaidItems are un-deduped by construction (each item has its own
  // providerRef scheme): the same bank re-linked through a new item is the classic silent
  // both-live double-count (slice-6 critic C-10), so those pairs stay eligible.
  if (lo.provider === hi.provider) {
    const differentPlaidItems =
      lo.provider === 'plaid' && lo.plaidItemId != null && hi.plaidItemId != null && lo.plaidItemId !== hi.plaidItemId;
    if (!differentPlaidItems) return null;
  }
  const signals = duplicateSignals(lo, hi);
  if (!signals) return null;
  return { a: toRef(lo), b: toRef(hi), confidence: signals.confidence, reasons: signals.reasons };
}

/**
 * All suspected cross-provider duplicate pairs among a user's accounts, most-confident first
 * (then by account name), for a stable render. Advisory only.
 */
export function detectDuplicateAccounts(
  accounts: DuplicateAccountCandidate[],
): SuspectedDuplicatePair[] {
  const sorted = [...accounts].sort(order);
  const pairs: SuspectedDuplicatePair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const flagged = evaluatePair(sorted[i], sorted[j]);
      if (flagged) pairs.push(flagged);
    }
  }
  const rank: Record<DuplicateConfidence, number> = { high: 0, medium: 1 };
  return pairs.sort(
    (p, q) =>
      rank[p.confidence] - rank[q.confidence] ||
      p.a.name.localeCompare(q.a.name) ||
      p.b.name.localeCompare(q.b.name),
  );
}

export function hasSuspectedDuplicates(accounts: DuplicateAccountCandidate[]): boolean {
  return detectDuplicateAccounts(accounts).length > 0;
}

// ---------------------------------------------------------------------------
// Household variant (TASKS 4.2 slice 8, critic F5 / T9(b)).
// ---------------------------------------------------------------------------

export interface HouseholdDuplicateAccountCandidate extends DuplicateAccountCandidate {
  /** The member who owns this account row (viewer or a partner). */
  ownerId: string;
  /** The owner's own name for the row (TASKS L.7), when he set one. Carried for LABELLING only:
   *  every comparison in this module reads `name`, and the caller may print this one only for
   *  the VIEWER's own rows — a partner's nickname never crosses to another member. */
  displayName?: string | null;
}

export interface HouseholdDuplicateRef extends DuplicateAccountRef {
  ownerId: string;
  /** Carried through for the CALLER to decide with (TASKS L.7): it may print this for the
   *  viewer's own row and must not for a partner's. Nothing in this module reads it. */
  displayName?: string | null;
}

export interface SuspectedHouseholdDuplicatePair {
  a: HouseholdDuplicateRef;
  b: HouseholdDuplicateRef;
  confidence: DuplicateConfidence;
  reasons: string[];
}

/**
 * Suspected duplicates across a HOUSEHOLD's visible account set (the viewer's
 * own accounts + every partner's shared accounts). Two partners who each
 * connect the SAME real joint bank account — via different providers or the
 * same one — mint two `Account` rows with different ids, so the merge's
 * disjoint-by-id guard can never catch it and every household figure counts
 * the money twice (critic F5). This detector is the disclosure half: ADVISORY
 * only, like the personal #192 detector — it never merges, drops, or adjusts a
 * number, because the heuristic has false positives and silently dropping a
 * REAL account from money math is strictly worse than a disclosed possible
 * double-count.
 *
 * The one difference from the personal detector: the same-provider skip
 * applies only WITHIN one owner ("same-provider ingest already dedups" is true
 * per user and false across two users) — both partners linking the same bank
 * through Plaid is the most likely F5 shape and must still be flagged.
 */
export function detectHouseholdDuplicateAccounts(
  accounts: HouseholdDuplicateAccountCandidate[],
): SuspectedHouseholdDuplicatePair[] {
  const sorted = [...accounts].sort(order);
  const pairs: SuspectedHouseholdDuplicatePair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const lo = sorted[i];
      const hi = sorted[j];
      if (lo.provider === hi.provider && lo.ownerId === hi.ownerId) continue;
      const signals = duplicateSignals(lo, hi);
      if (!signals) continue;
      pairs.push({
        a: { ...toRef(lo), ownerId: lo.ownerId, displayName: lo.displayName ?? null },
        b: { ...toRef(hi), ownerId: hi.ownerId, displayName: hi.displayName ?? null },
        confidence: signals.confidence,
        reasons: signals.reasons,
      });
    }
  }
  const rank: Record<DuplicateConfidence, number> = { high: 0, medium: 1 };
  return pairs.sort(
    (p, q) =>
      rank[p.confidence] - rank[q.confidence] ||
      p.a.name.localeCompare(q.a.name) ||
      p.b.name.localeCompare(q.b.name),
  );
}

// ---------------------------------------------------------------------------
// Cross-provider reconciliation candidates (TASKS Wave 4.6 slice 1 —
// docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md §8 direction rule + §10 slice 1).
// ---------------------------------------------------------------------------

/**
 * A duplicate candidate annotated with whether the row still has a LIVE provider connection.
 * Freshness lives on the connection rows, not on `Account` (SimpleFinConnection/PlaidItem —
 * §1.2), so the caller derives this: a SimpleFIN row whose connection was disconnected, or a
 * manual row that never synced, is not live. Demo rows are excluded upstream and never reach here.
 */
export interface ReconciliationAccountCandidate extends DuplicateAccountCandidate {
  hasLiveConnection: boolean;
  /** The identity-bearing fields (identity.ts), when the caller can supply them. Required for a
   *  SAME-provider proposal — two Plaid connections at one bank — which is admitted only on
   *  PROVEN identity, never on the heuristic signals below. Omit it and same-provider pairs are
   *  skipped exactly as they were before TASKS L.10. */
  identity?: IdentityAccount;
}

/**
 * A DIRECTIONAL reconciliation proposal: the stale/disconnected `predecessor` becomes historical
 * (its balance stops counting; it keeps only transactions on/before the cutover date) and the live
 * `successor` continues the same real account (its live balance counts; it owns transactions after
 * the cutover). This slice only PROPOSES — it mutates nothing. `matchSignal`/`confidence` carry the
 * #192 evidence that suggested the pair (schema `AccountReconciliation.matchSignal`, §4).
 */
export interface ReconciliationCandidate {
  predecessor: DuplicateAccountRef;
  successor: DuplicateAccountRef;
  confidence: DuplicateConfidence;
  matchSignal: ReconciliationMatchSignal;
  reasons: string[];
  /** True only for the same-provider identity-ladder path (a tier-P or mask-tier PROOF from
   *  identity.ts), never for a heuristic signal. A proven pair outranks heuristic rivals inside
   *  an ambiguity group: withholding it would say "we cannot tell which" about a pair the app
   *  can prove (critic P2-3). */
  provenIdentity?: boolean;
}

/**
 * One stale row that resembles SEVERAL live accounts, carried out rather than dropped (TASKS L.9).
 * A predecessor is the continuation of exactly one real account, so two proposals for one row are
 * not two chances to be right — they are the app saying "it is one of these" while badging both
 * identically, and confirming the wrong one folds the wrong history. The offer is withheld and the
 * caller states the ambiguity: a filter that discards an unknown must carry it out
 * (docs/lessons/an-empty-set-is-not-a-fact-about-money.md).
 */
export interface AmbiguousReconciliationGroup {
  predecessor: DuplicateAccountRef;
  /** The live accounts it matched, ≥2, deterministically ordered. */
  successors: DuplicateAccountRef[];
}

export interface ReconciliationCandidateSet {
  /** Offerable: exactly one live account matched this predecessor. */
  candidates: ReconciliationCandidate[];
  /** Not offerable, and not silent either. */
  ambiguous: AmbiguousReconciliationGroup[];
}

export interface ReconciliationDetectOptions {
  /**
   * Pairs the caller has already resolved — reconciled, dismissed as "not a duplicate", or whose
   * predecessor is already inside an effective link. Passed IN rather than filtered out afterwards
   * because the ambiguity rule above has to be decided over the set that will actually render: a
   * predecessor matching two successors, one of which the user already dismissed, is not ambiguous
   * at all, and withholding the survivor would strand him (a guard must read what it guards).
   *
   * CONTRACT: the callback must be ORDER-INDEPENDENT — `excludePair(a, b) === excludePair(b, a)`
   * for every pair (cycle-3 critic P2: the proven-partner counting loop probes both orders while
   * the candidate filter probes role order, so a direction-sensitive callback can land two proven
   * pairs for one predecessor in a single group — the state this module declares impossible).
   * The one production caller builds it from sorted pair-keys and membership sets, which hold.
   */
  excludePair?: (predecessorId: string, successorId: string) => boolean;
}

/**
 * Suspected duplicate pairs that have a well-defined predecessor→successor direction, most-confident
 * first. Advisory only; proposes nothing where direction is ambiguous.
 *
 * Direction rule (R3, §8): offer the continue-flow ONLY when exactly one side has a live connection —
 * that side is the successor, the other the predecessor. When BOTH sides are live the pair is a
 * genuine active duplicate and is never auto-linked (the advisory #192 warning stays); when NEITHER
 * is live there is no live row to continue into. Both cases yield no candidate.
 */
export function detectReconciliationCandidates(
  accounts: ReconciliationAccountCandidate[],
  options: ReconciliationDetectOptions = {},
): ReconciliationCandidateSet {
  const sorted = [...accounts].sort(order);
  const exclude = options.excludePair ?? (() => false);
  // Proven-identity partner counts, by ROLE (cycle-2 critic P1, executed): liveness decides what
  // a proven pair can compete for, and counting every pair against both sides deadlocked the L.10
  // re-link shape — X proven-same to a live Y and a DEAD Z had "two partners", so X→Y was
  // withheld by a pair (X↔Z) that can never compete for a fold (both-dead has no direction, R3),
  // leaving two stale rows double-counting against Y with no offer and no statement.
  //   - deadChoices:   a DIRECTED proven pair counts only against its DEAD side — those are the
  //                    competing successor choices for that row's fold (the L.9 ambiguity rule's
  //                    proven counterpart).
  //   - liveTangles:   a BOTH-LIVE proven pair counts against each live side — an unresolved
  //                    combine. A successor tangled in one is not a clean fold target (the P2-2
  //                    corollary: resolve the both-live pair first, then the stale fold releases).
  //   - both-dead:     counts against nothing — no direction, no fold competition.
  // Counted over pairs that SURVIVE the caller's exclusion, so dismissing/resolving a pair
  // releases the survivor exactly as it releases a heuristic one (critic P2-2 — a guard must
  // read what it guards).
  const deadChoices = new Map<string, number>();
  const liveTangles = new Map<string, number>();
  const withheldProvenPredecessors = new Set<string>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const lo = sorted[i];
      const hi = sorted[j];
      if (lo.provider !== hi.provider || !lo.identity || !hi.identity) continue;
      if (compareAccountIdentity(lo.identity, hi.identity).verdict !== 'same') continue;
      if (exclude(lo.id, hi.id) || exclude(hi.id, lo.id)) continue;
      if (lo.hasLiveConnection && hi.hasLiveConnection) {
        bump(liveTangles, lo.id);
        bump(liveTangles, hi.id);
      } else if (lo.hasLiveConnection !== hi.hasLiveConnection) {
        bump(deadChoices, lo.hasLiveConnection ? hi.id : lo.id);
      }
    }
  }

  const out: ReconciliationCandidate[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const lo = sorted[i];
      const hi = sorted[j];
      let confidence: DuplicateConfidence;
      let matchSignal: ReconciliationMatchSignal;
      let reasons: string[];
      if (lo.provider === hi.provider) {
        // SAME provider, two connections (TASKS L.10). This is the state left behind when a
        // both-live duplicate is half-resolved — the user disconnected one Chase connection, or
        // a combine disconnected it and then failed to link — and without this the app would
        // offer no way to finish, which is what the copy on that failure promises.
        //
        // Admitted ONLY on the identity ladder's proof (identity.ts), never on the heuristic
        // signals below: inside one provider a differing last-4 means a different account, so a
        // balance or name match here could propose merging a spouse's card away. Callers that
        // supply no identity keep the original blanket skip.
        const proven = lo.identity && hi.identity ? compareAccountIdentity(lo.identity, hi.identity) : null;
        if (!proven || proven.verdict !== 'same') continue;
        // Role-based guard (the counts above): a stale row with SEVERAL live proven choices has
        // proven nothing about any one of them — withhold rather than badge two folds identically;
        // and a successor tangled in an unresolved BOTH-LIVE proven pair is not a clean fold
        // target — the combine card owns that pair, and resolving it releases this one.
        if (lo.hasLiveConnection !== hi.hasLiveConnection) {
          const deadId = lo.hasLiveConnection ? hi.id : lo.id;
          const liveId = lo.hasLiveConnection ? lo.id : hi.id;
          if ((deadChoices.get(deadId) ?? 0) > 1 || (liveTangles.get(liveId) ?? 0) > 0) {
            // …and remember the withheld stale row (cycle-3 critic P1, executed): a predecessor
            // whose PROVEN folds are withheld must never see its HEURISTIC rivals offered either —
            // a lone name-match would otherwise surface as a clean sole candidate, an offer the
            // app can prove is the wrong account. The app's own proof outranks a guess: the
            // heuristic pairs stay ordinary dismissable warnings on the duplicate notice, and the
            // proven tangle stays owned by the combine card, whose resolution releases the stale
            // fold. (Deliberately NOT an ambiguity group: naming the heuristic rivals as "the ones
            // it might be" would mislead beside the proven tangle the combine card already states.)
            withheldProvenPredecessors.add(deadId);
            continue;
          }
        }
        confidence = 'high';
        matchSignal = proven.tier === 'P' ? 'persistent' : 'mask';
        reasons = [...proven.reasons];
      } else {
        const signals = duplicateSignals(lo, hi);
        if (!signals) continue;
        confidence = signals.confidence;
        matchSignal = signals.signal;
        reasons = signals.reasons;
      }
      // R3: a direction exists only with exactly one live side. Both-live (active duplicate) and
      // both-dead (no live row) are equal here → skip, proposing nothing.
      if (lo.hasLiveConnection === hi.hasLiveConnection) continue;
      const successor = lo.hasLiveConnection ? lo : hi;
      const predecessor = lo.hasLiveConnection ? hi : lo;
      out.push({
        predecessor: toRef(predecessor),
        successor: toRef(successor),
        confidence,
        matchSignal,
        reasons,
        provenIdentity: lo.provider === hi.provider,
      });
    }
  }
  const rank: Record<DuplicateConfidence, number> = { high: 0, medium: 1 };
  const ranked = out
    // Withheld-proven predecessors never reach the offer/group stage at all (see the guard).
    .filter((c) => !withheldProvenPredecessors.has(c.predecessor.id) && !exclude(c.predecessor.id, c.successor.id))
    .sort(
      (p, q) =>
        rank[p.confidence] - rank[q.confidence] ||
        p.successor.name.localeCompare(q.successor.name) ||
        p.predecessor.name.localeCompare(q.predecessor.name),
    );

  // One predecessor, several live matches → offer none of them and say so. Grouped by the
  // PREDECESSOR only: two old rows folding into one live account is valid data the app already
  // supports (#297, one successor supersedes several), while one old row continuing into two
  // different live accounts is impossible. The one exception: a PROVEN-identity pair (the bank's
  // own cross-item id) outranks heuristic rivals — withholding it would say "we cannot tell
  // which" about a pair the app can prove (critic P2-3). The withheld rivals still warn on the
  // duplicate notice, where the user can dismiss them; at most one proven pair can exist per
  // predecessor (two live proven choices is exactly what the deadChoices guard withholds above).
  const groups = new Map<string, ReconciliationCandidate[]>();
  for (const c of ranked) {
    const list = groups.get(c.predecessor.id);
    if (list) list.push(c);
    else groups.set(c.predecessor.id, [c]);
  }
  const candidates: ReconciliationCandidate[] = [];
  const ambiguous: AmbiguousReconciliationGroup[] = [];
  for (const list of groups.values()) {
    const proven = list.filter((c) => c.provenIdentity === true);
    if (list.length === 1) {
      candidates.push(list[0]);
      continue;
    }
    if (proven.length === 1) {
      candidates.push(proven[0]);
      continue;
    }
    ambiguous.push({
      predecessor: list[0].predecessor,
      successors: list
        .map((o) => o.successor)
        .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id)),
    });
  }
  // The proven hoist can interleave the confidence order the contract documents — re-apply it.
  candidates.sort(
    (p, q) =>
      rank[p.confidence] - rank[q.confidence] ||
      p.successor.name.localeCompare(q.successor.name) ||
      p.predecessor.name.localeCompare(q.predecessor.name),
  );
  return { candidates, ambiguous };
}
