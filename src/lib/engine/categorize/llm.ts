/**
 * LLM-assisted categorization — PURE pieces (DECISIONS #38).
 *
 * The deterministic pipeline (normalize → rules → merchant table) handles the
 * vast majority of transactions. For genuinely unknown merchants it routes to
 * review. An optional LLM can propose a category for those — but only as a
 * SUGGESTION that still flows through the same confidence routing and the user's
 * confirmation→rule loop, so it can never silently mislabel.
 *
 * Everything here is pure + testable. The network call lives in the server
 * (src/server/llm-categorize.ts); with no ANTHROPIC_API_KEY it returns null and
 * the deterministic result stands unchanged (the demo-mode invariant).
 */
import { ASSIGNABLE_CATEGORIES, } from './assign';
import { CATEGORY_BY_ID } from './categories';
import { AUTO_FLAGGED_BPS } from './pipeline';

export interface LlmCategory {
  categoryId: string;
  confidenceBps: number;
}

/**
 * Validate an LLM JSON response against the known category set (our "schema").
 * Returns null on anything malformed — unknown id, missing/invalid confidence,
 * non-object — so the caller falls back to the deterministic result.
 * Contract: { "categoryId": "<assignable id>", "confidence": <0..1> }.
 */
export function parseLlmCategory(raw: unknown): LlmCategory | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = obj.categoryId;
  if (typeof id !== 'string' || !CATEGORY_BY_ID.has(id) || id === 'uncategorized') return null;
  const conf = obj.confidence;
  if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) return null;
  return { categoryId: id, confidenceBps: Math.round(conf * 10000) };
}

/** Build the (deterministic) classification prompt for one transaction. */
export function buildCategorizePrompt(input: { rawDescriptor: string; amountCents: number }): string {
  const ids = ASSIGNABLE_CATEGORIES.map((c) => `${c.id} (${c.name})`).join(', ');
  const dollars = (Math.abs(input.amountCents) / 100).toFixed(2);
  const direction = input.amountCents < 0 ? 'debit/outflow' : 'credit/inflow';
  return [
    'Classify this bank transaction into exactly one of the allowed categories.',
    `Descriptor: ${input.rawDescriptor}`,
    `Amount: $${dollars} (${direction})`,
    `Allowed category ids: ${ids}.`,
    'Respond with ONLY a JSON object, no prose: {"categoryId":"<one allowed id>","confidence":<number 0..1>}.',
  ].join('\n');
}

/**
 * Decide the final category given the deterministic result and an optional LLM
 * suggestion. The LLM may override ONLY when the deterministic pipeline was
 * unsure (routed to review / uncategorized) AND the LLM returned a confident,
 * valid pick. A confident deterministic call (known merchant, user rule) is
 * never overridden by the model. Pure → fully testable.
 */
export function pickAssistedCategory(
  deterministic: { categoryId: string; confidenceBps: number; needsReview: boolean },
  llm: LlmCategory | null,
): { categoryId: string; confidenceBps: number; source: 'deterministic' | 'llm' } {
  const unsure = deterministic.needsReview || deterministic.categoryId === 'uncategorized';
  if (unsure && llm && llm.confidenceBps >= AUTO_FLAGGED_BPS) {
    return { categoryId: llm.categoryId, confidenceBps: llm.confidenceBps, source: 'llm' };
  }
  return {
    categoryId: deterministic.categoryId,
    confidenceBps: deterministic.confidenceBps,
    source: 'deterministic',
  };
}
