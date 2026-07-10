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
}

export interface DuplicateAccountRef {
  id: string;
  name: string;
  provider: string;
  mask: string | null;
}

export type DuplicateConfidence = 'high' | 'medium';

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
 * Evaluate one ordered pair. Returns a flagged pair, or null when the two accounts are not a
 * suspected duplicate. Assumes `lo` and `hi` are already in `order()` order.
 */
function evaluatePair(
  lo: DuplicateAccountCandidate,
  hi: DuplicateAccountCandidate,
): SuspectedDuplicatePair | null {
  // Only cross-provider pairs can be un-deduped duplicates; same-provider ingest already dedups.
  if (lo.provider === hi.provider) return null;
  if (EXCLUDED_PROVIDERS.has(lo.provider) || EXCLUDED_PROVIDERS.has(hi.provider)) return null;
  // A genuine duplicate is the same account: same type and same currency are hard prerequisites.
  if (lo.type !== hi.type) return null;
  if (normalizeCurrency(lo.currency) !== normalizeCurrency(hi.currency)) return null;

  const reasons: string[] = [];
  let confidence: DuplicateConfidence | null = null;

  const maskMatch = !!lo.mask && !!hi.mask && lo.mask === hi.mask;
  if (maskMatch) {
    reasons.push(`same last-4 (${lo.mask})`);
    confidence = 'high';
  }

  // Identical non-zero balance is a strong signal; zero is excluded (many empty accounts share 0).
  const balanceMatch = lo.currentBalanceCents === hi.currentBalanceCents && lo.currentBalanceCents !== 0;
  if (balanceMatch) {
    reasons.push('identical balance');
    confidence = 'high';
  }

  const shared = sharedTokens(lo.name, hi.name);
  if (shared.length > 0) {
    reasons.push(`shared name: ${shared.map((t) => `“${t}”`).join(', ')}`);
    if (confidence === null) confidence = 'medium';
  }

  if (confidence === null) return null;
  return { a: toRef(lo), b: toRef(hi), confidence, reasons };
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
