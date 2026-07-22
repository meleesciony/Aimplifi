/**
 * ONE provider selection and ONE round-trip for every LLM egress path
 * (2026-07-21 agent review, finding B2).
 *
 * Five modules — assistant-llm, balance-move-llm, llm-categorize,
 * llm-statement-extract, money-review-llm — each carried a byte-identical copy of
 * the same ~45 lines: key precedence, both provider request shapes, the 7s abort,
 * and response-text extraction. They differed ONLY in `max_tokens` and the prompt.
 * Three of the five had also drifted into a bare `else` with a non-null-asserted
 * Anthropic key (`anthropicKey!`) where the other two used `else if (anthropicKey)`;
 * this module keeps the guarded form, so no call site can assert a key it lacks.
 *
 * Contract — unchanged from every copy it replaces:
 *   - XAI_API_KEY set        → xAI Grok (OpenAI-compatible) — PREFERRED (cheaper).
 *   - else ANTHROPIC_API_KEY → Anthropic Messages API.
 *   - neither                → `llmProviderConfigured()` is false. Callers check it
 *     THEMSELVES and return before building a prompt, because "no key" must not
 *     report an `onOutcome` for a call that was never attempted (AI plan §3.2:
 *     exactly one report per ATTEMPTED call).
 *   - return `null`   → unavailable: non-OK status, network error, timeout abort,
 *     or a body that isn't JSON. The caller maps this to its own fallback.
 *   - return a string → the provider replied. Validation/parsing stays with the
 *     caller: this module never interprets model output.
 *
 * Env is read on EVERY call, never cached at module scope — tests set and clear
 * keys between calls, and a deployment can rotate one without a restart.
 *
 * Plain module: no 'use server' (this is not an invokable action — a client must
 * never be able to burn provider credits, the #242 rule) and no 'server-only'
 * (vocab.ts pulls this graph into the tsx-script e2e fixture, where that package
 * throws at import) — the same posture as the five callers.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const XAI_DEFAULT_MODEL = 'grok-3-mini';

/** Bound every round-trip so a slow or unreachable provider can never hang a
 *  request — on timeout we abort and the caller falls back deterministically. */
export const LLM_TIMEOUT_MS = 7000;

/**
 * Is ANY provider key present? Callers gate on this before building a prompt, so
 * the zero-credential demo never touches the network (CLAUDE.md rule 4).
 *
 * Written as two explicit Boolean() checks rather than `a ?? b`: an empty-string
 * XAI_API_KEY alongside a real ANTHROPIC_API_KEY is still "configured", and
 * `?? ` would have kept the empty string and reported false.
 */
export function llmProviderConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY) || Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * One completion round-trip. `null` means unavailable (see the module contract);
 * a string is the raw model text, unparsed and untrusted.
 */
export async function llmCompleteText(prompt: string, maxTokens: number): Promise<string | null> {
  const xaiKey = process.env.XAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  // null until the provider yields a usable text body — anything short of that
  // (non-OK status, network error, timeout abort, malformed body) stays null.
  let text: string | null = null;
  try {
    if (xaiKey) {
      // xAI Grok — OpenAI-compatible /chat/completions.
      const res = await fetch(XAI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: process.env.XAI_MODEL ?? XAI_DEFAULT_MODEL,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        text = data?.choices?.[0]?.message?.content ?? '';
      }
    } else if (anthropicKey) {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? ANTHROPIC_DEFAULT_MODEL,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { content?: { text?: string }[] };
        text = Array.isArray(data?.content) ? data.content.map((b) => b?.text ?? '').join('') : '';
      }
    }
  } catch {
    text = null; // network error / abort / bad body JSON → unavailable
  } finally {
    clearTimeout(timer);
  }
  return text;
}
