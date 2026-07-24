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
}

export interface DuplicateAccountRef {
  id: string;
  name: string;
  provider: string;
  mask: string | null;
}

export type DuplicateConfidence = 'high' | 'medium';

/** The strongest positive signal that fired for a pair (mask > balance > name). */
export type ReconciliationMatchSignal = 'mask' | 'balance' | 'name';

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
  const masksDiffer = !!lo.mask && !!hi.mask && lo.mask !== hi.mask;

  const reasons: string[] = [];
  let confidence: DuplicateConfidence | null = null;

  const maskMatch = !!lo.mask && !!hi.mask && lo.mask === hi.mask;
  if (maskMatch) {
    reasons.push(`same last-4 (${lo.mask})`);
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
}

export interface HouseholdDuplicateRef extends DuplicateAccountRef {
  ownerId: string;
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
        a: { ...toRef(lo), ownerId: lo.ownerId },
        b: { ...toRef(hi), ownerId: hi.ownerId },
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
): ReconciliationCandidate[] {
  const sorted = [...accounts].sort(order);
  const out: ReconciliationCandidate[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const lo = sorted[i];
      const hi = sorted[j];
      // Cross-provider only, exactly as #192: same-provider ingest already dedups.
      if (lo.provider === hi.provider) continue;
      const signals = duplicateSignals(lo, hi);
      if (!signals) continue;
      // R3: a direction exists only with exactly one live side. Both-live (active duplicate) and
      // both-dead (no live row) are equal here → skip, proposing nothing.
      if (lo.hasLiveConnection === hi.hasLiveConnection) continue;
      const successor = lo.hasLiveConnection ? lo : hi;
      const predecessor = lo.hasLiveConnection ? hi : lo;
      out.push({
        predecessor: toRef(predecessor),
        successor: toRef(successor),
        confidence: signals.confidence,
        matchSignal: signals.signal,
        reasons: signals.reasons,
      });
    }
  }
  const rank: Record<DuplicateConfidence, number> = { high: 0, medium: 1 };
  return out.sort(
    (p, q) =>
      rank[p.confidence] - rank[q.confidence] ||
      p.successor.name.localeCompare(q.successor.name) ||
      p.predecessor.name.localeCompare(q.predecessor.name),
  );
}
