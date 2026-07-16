import 'server-only';

/**
 * Balance-Move Explainer read-path (AI plan §2.3, DECISIONS #240). Reshapes the
 * ALREADY-computed spending trends into a grounded one-liner: the deterministic
 * template by default (and always in demo / zero-key), optionally reworded from a
 * key-gated LLM TEMPLATE whose placeholders the engine substitutes — so a rendered
 * sentence can't fabricate or swap a figure. Read-only; numbers come only from the
 * trends engine, so this can't drift from /trends.
 */
import {
  explainBalanceMove,
  resolveMoveSentence,
  type BalanceMoveExplanation,
} from '@/lib/engine/trends/balance-move';
import type { SpendingTrends } from '@/lib/engine/trends/trends';
import { draftMoveSentenceViaLLM } from '@/server/balance-move-llm';
import { DEMO_USER_ID } from '@/lib/demo-user';

export interface BalanceMoveView {
  sentence: string;
  /** True only when a VALIDATED, engine-substituted LLM template was used. */
  interpreted: boolean;
  comparedYm: string | null;
}

/**
 * Per-instance memo keyed by (user, month, exact figures). The movers describe a
 * COMPLETED month, so the wording is stable — this avoids a fresh LLM round-trip
 * (and nondeterministic wording) on every /trends render. Bounded; ephemeral.
 */
const CACHE = new Map<string, BalanceMoveView>();
const CACHE_MAX = 500;

function cacheKey(userId: string, e: BalanceMoveExplanation): string {
  // Sign the full rendered basis so a rename (label), a backfilled baseline (pct or
  // window), or any figure change busts the memo (critic cycle-2 P2-4 / cycle-3 P2-5).
  const sig = e.factors.map((f) => `${f.id}:${f.deltaCents}:${f.formattedPct ?? ''}:${f.label}`).join(',');
  return `${userId}|${e.comparedYm}|${e.comparisonWindowText}|${sig}`;
}
function remember(key: string, view: BalanceMoveView): BalanceMoveView {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
  CACHE.set(key, view);
  return view;
}

/**
 * Resolve the explainer for a user's trends. Returns null when nothing moved.
 * `trends` is passed in so the page computes it once; only the small
 * custom-category lookup is re-fetched here.
 */
export async function getBalanceMove(userId: string, trends: SpendingTrends): Promise<BalanceMoveView | null> {
  const explanation = explainBalanceMove(trends);
  if (!explanation.triggered) return null;

  const key = cacheKey(userId, explanation);
  const cached = CACHE.get(key);
  if (cached) return cached;

  // The demo account is deterministic by CONSTRUCTION, never by env: even if a
  // deployment sets an API key, demo visitors get the stable template, never a
  // model rewording (matches the shared-demo discipline; here purely for stability).
  const llm = userId === DEMO_USER_ID ? null : await draftMoveSentenceViaLLM(explanation);
  const resolved = resolveMoveSentence(explanation, llm);

  if (!resolved.sentence) return null;
  return remember(key, {
    sentence: resolved.sentence,
    interpreted: resolved.interpreted,
    comparedYm: explanation.comparedYm,
  });
}
