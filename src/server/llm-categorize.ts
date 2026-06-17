'use server';

/**
 * LLM categorization client (DECISIONS #38). Calls the Anthropic Messages API to
 * propose a category for an unknown transaction. Graceful, tested fallback:
 *   - no ANTHROPIC_API_KEY  → returns null (deterministic pipeline stands).
 *   - any network/parse/validation failure → returns null (never throws).
 * The result is always validated by parseLlmCategory before use, so a malformed
 * or hallucinated category can't reach the ledger.
 */
import { buildCategorizePrompt, type LlmCategory, parseLlmCategory } from '@/lib/engine/categorize/llm';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export async function suggestCategoryViaLLM(input: {
  rawDescriptor: string;
  amountCents: number;
}): Promise<LlmCategory | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null; // demo mode / no key → deterministic fallback

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
        max_tokens: 100,
        messages: [{ role: 'user', content: buildCategorizePrompt(input) }],
      }),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const blocks = (data as { content?: { text?: string }[] })?.content;
    const text = Array.isArray(blocks) ? blocks.map((b) => b?.text ?? '').join('') : '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    return parseLlmCategory(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null; // network error, bad JSON, etc. → fall back deterministically
  }
}
