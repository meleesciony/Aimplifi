import 'server-only';

/**
 * LLM statement-extraction client (Doc Extractor v1, AI plan §3.3, DECISIONS
 * #247). Same provider posture as llm-categorize.ts:
 *   - XAI_API_KEY set        → xAI Grok (OpenAI-compatible, cheaper) — PREFERRED.
 *   - else ANTHROPIC_API_KEY  → Anthropic Messages API.
 *   - neither                → null (the form stays a plain manual form).
 *   - any network/parse/validation failure OR a 7s timeout → null (never
 *     throws, never hangs — the calling server action must always return).
 * The reply is always validated by parseLlmStatementExtract before use, and
 * the caller grounds every surviving span against the text the model saw —
 * the model can point, never author (see engine/doc-extract/statement.ts).
 *
 * The input text MUST already be scrubbed (scrubAccountNumbers) by the caller;
 * this module sends exactly what it is given.
 *
 * `onOutcome` (§3.2 Trust Center): called exactly once per ATTEMPTED provider
 * call — 'replied' (validator-surviving span claims, meta {count}), 'rejected'
 * (the guardrail discarded the reply), 'unavailable' (provider error/timeout).
 * No key → no call → the sink is NOT invoked. Sink faults never break the
 * extraction.
 */
import type { AiOutcomeSink } from '@/lib/engine/ai-audit/describe';
import {
  buildStatementExtractPrompt,
  type LlmFieldSpan,
  parseLlmStatementExtract,
} from '@/lib/engine/doc-extract/statement';
import { llmCompleteText, llmProviderConfigured } from '@/server/llm-provider';

// Five short span claims ≈ 300 tokens; 600 leaves headroom without inviting
// the model to dump the statement back.
const MAX_TOKENS = 600;

/** Extract the first JSON object from model text and validate it (→ null if bad). */
function parseFromText(text: string): LlmFieldSpan[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return parseLlmStatementExtract(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export async function extractStatementViaLLM(
  input: { scrubbedText: string },
  onOutcome?: AiOutcomeSink,
): Promise<LlmFieldSpan[] | null> {
  const prompt = buildStatementExtractPrompt(input.scrubbedText);
  if (!llmProviderConfigured()) return null; // no key → no network, form stays manual

  // null = unavailable: non-OK status, network error, timeout abort, malformed body.
  const text = await llmCompleteText(prompt, MAX_TOKENS);

  const value = text === null ? null : parseFromText(text);
  try {
    // Meta is closed-set only: a plain integer count of validator-surviving
    // span claims. Never model text, never a span (§3.2 sink contract).
    await onOutcome?.(
      text === null ? 'unavailable' : value ? 'replied' : 'rejected',
      value ? { count: value.length } : {},
    );
  } catch {
    // an audit fault must never break extraction
  }
  return value;
}
