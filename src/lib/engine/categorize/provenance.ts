/**
 * Category provenance (AI_DIFFERENTIATION_PLAN §3.1, "Why-This-Category").
 *
 * PURE display classifier: maps the *stored facts* about how a transaction's
 * category was decided into a single, honest provenance verdict for the UI. It
 * authors no number, touches no network or DB, and — the cardinal rule of this
 * feature — NEVER guesses `llm` vs `deterministic` where the source was not
 * actually recorded. An AI guess is shown as an AI guess only when the row was
 * persisted with `source === 'llm'`; a row predating the source column reads an
 * honest `not-recorded`, never a fabricated origin.
 *
 * The persisted `source` is a COMPOSITION of the two axes the engine already
 * computes: the pipeline's `CategorySource` (categorize/pipeline.ts), replaced
 * by `'llm'` when the LLM assist overlay (categorize/llm.ts `pickAssistedCategory`)
 * won an unsure row. See WHY_THIS_CATEGORY_PLAN.md.
 */
import type { CategorySource } from './pipeline';

/** What we persist on `CategoryPrediction.source`: the pipeline axis plus the LLM overlay. */
export type PredictionSource = CategorySource | 'llm';

/**
 * The trust-relevant partition shown to the user. Distinct from `PredictionSource`
 * because (a) a user-labeled row reads `user-set` regardless of its original
 * origin — the human is the final fact-setter — and (b) rows predating the
 * feature read `not-recorded` rather than a guessed origin.
 */
export type ProvenanceKind =
  | 'user-set' // the human dictated or corrected this category
  | 'your-rule' // a rule the user set (or a learned rule) matched
  | 'merchant-default' // a known-merchant default
  | 'provider' // the bank/aggregator's own category hint
  | 'transfer' // detected as a transfer between accounts
  | 'ai-guess' // the LLM proposed this for an unsure row — needs confirmation
  | 'uncategorized' // the pipeline honestly abstained
  | 'not-recorded'; // source predates this feature — origin unknown, never guessed

export interface ProvenanceInput {
  /** Persisted `CategoryPrediction.source`, or null when the row predates the column. */
  source: PredictionSource | null;
  /** False when NO prediction row exists for the transaction. */
  hasPredictionRow: boolean;
  /**
   * The transaction's own `confidenceBps`. 10000 is reserved for a USER-dictated
   * category (a manual/CSV category the user typed) — the pipeline maxes at 9900,
   * and such rows are never logged as predictions (server/predictions.ts).
   */
  txnConfidenceBps: number;
  /**
   * True when a USER has labeled/confirmed/corrected this row — i.e. the
   * prediction row's `actualCategoryId` was set by a user action (`labeledAt`
   * non-null). Once a human sets the fact, provenance is "you set this" and the
   * original AI/merchant origin is history — so this OVERRIDES `source`.
   */
  userLabeled: boolean;
  /**
   * The prediction row's `predictedCategoryId` (null when no row). The stored
   * `source` describes the origin of THIS category.
   */
  predictedCategoryId: string | null;
  /**
   * The transaction's CURRENT `categoryId`. The prediction row is create-only
   * (the FIRST verdict), but the current category can move afterward — a backfill
   * LLM re-file, a sync verdict refresh, a household-partner correction (which
   * sets the category but not `labeledAt`). When current ≠ predicted, the stored
   * `source` no longer describes what's shown, so we must NOT surface it as the
   * current category's origin (hostile critic P1-3).
   */
  currentCategoryId: string | null;
}

export interface ProvenanceVerdict {
  kind: ProvenanceKind;
  /** Owner-neutral, no-shame label. The single source of truth for the badge copy. */
  label: string;
  /** True ONLY for `ai-guess` — the one kind routed to a visible confirm affordance. */
  needsConfirm: boolean;
}

/** Canonical, no-shame labels. Slice-2 UI renders these; tests pin them. */
const LABELS: Record<ProvenanceKind, string> = {
  'user-set': 'You set this',
  'your-rule': 'Your rule',
  'merchant-default': 'Known merchant',
  provider: 'From your bank',
  transfer: 'Transfer',
  'ai-guess': 'AI guess — needs your OK',
  uncategorized: 'Needs a category',
  'not-recorded': 'Source not recorded',
};

function verdict(kind: ProvenanceKind): ProvenanceVerdict {
  return { kind, label: LABELS[kind], needsConfirm: kind === 'ai-guess' };
}

/**
 * Classify a transaction's category provenance. Total over every input; the only
 * path to `ai-guess` is a persisted `source === 'llm'` on a row the user has not
 * yet labeled — origin is never inferred from confidence or category.
 */
export function describeProvenance(input: ProvenanceInput): ProvenanceVerdict {
  // (1) The human is the final fact-setter. A labeled/corrected row is "you set
  // this" no matter what proposed it first — never surface a stale AI/merchant
  // origin, and never ask to confirm what a person already confirmed.
  if (input.userLabeled) return verdict('user-set');

  // (2) A user-dictated category (manual/CSV) carries confidence 10000 and is
  // never logged as a prediction — so no row + 10000 is the human dictating it.
  if (!input.hasPredictionRow && input.txnConfidenceBps === 10000) return verdict('user-set');

  // (3) No prediction row (and not user-dictated) → predates prediction logging.
  //     Honest, never a guessed origin.
  if (!input.hasPredictionRow) return verdict('not-recorded');

  // (4) A prediction row exists but predates the source column → origin unknown.
  //     This is the ONLY place we refuse to name an origin; we never fabricate one.
  if (input.source === null) return verdict('not-recorded');

  // (4b) The recorded source describes the FIRST-verdict category. If the current
  //      category has since moved (backfill re-file, sync refresh, partner
  //      correction) the stored source is stale — surfacing it would name a false
  //      origin for what's shown. Honest floor: 'not-recorded' (critic P1-3).
  if (input.predictedCategoryId !== input.currentCategoryId) return verdict('not-recorded');

  // (5) A recorded source maps to exactly one kind. Exhaustive over PredictionSource.
  switch (input.source) {
    case 'llm':
      return verdict('ai-guess');
    case 'user-rule':
      return verdict('your-rule');
    case 'merchant-default':
      return verdict('merchant-default');
    case 'provider-category':
      return verdict('provider');
    case 'transfer':
      return verdict('transfer');
    case 'fallback':
      return verdict('uncategorized');
    default:
      // Type-level exhaustiveness (compile-time only, no runtime var): if
      // PredictionSource gains a member, `satisfies never` stops compiling until
      // the switch handles it. At runtime a corrupt/unknown source string (should
      // be unrepresentable) never crashes and never guesses — it degrades to the
      // honest "not recorded".
      input.source satisfies never;
      return verdict('not-recorded');
  }
}
