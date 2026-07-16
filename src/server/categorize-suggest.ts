import 'server-only';

/**
 * The ONE way a call site obtains an LLM category-suggest function (#242 critic
 * cycle-2 F1/F5). Centralizing the demo fence + audit sink here means every
 * categorize path — manual create, CSV import, Plaid sync, SimpleFIN sync,
 * backfill — gets both by construction, and ONE executed test covers the fence
 * for all of them (a per-call-site one-line ternary is exactly what a future
 * refactor silently drops; cycle 2 proved it by finding two sites cycle 1's fix
 * missed).
 *
 * Demo fence: the shared demo account never consults a provider — even on a
 * keyed deployment, even after a visitor connects a bank to it — so the Trust
 * Center's demo copy ("it never consults a model … on any deployment") is an
 * enforced invariant, not a deployment accident. The null suggest is exactly
 * the keyless behavior: rows stand unchanged, deterministically.
 *
 * `server-only` is safe here (unlike ai-audit.ts): nothing on the tsx-script
 * import graph (vocab.ts et al.) imports this module, and llm-categorize.ts
 * below carries `server-only` itself already.
 */
import type { LlmCategory } from '@/lib/engine/categorize/llm';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { aiAuditSink } from '@/server/ai-audit';
import { suggestCategoryViaLLM } from '@/server/llm-categorize';

export type CategorySuggest = (input: {
  rawDescriptor: string;
  amountCents: number;
}) => Promise<LlmCategory | null>;

export function categorizeSuggestFor(userId: string): CategorySuggest {
  if (userId === DEMO_USER_ID) return async () => null;
  const sink = aiAuditSink(userId, 'categorize'); // Trust Center trail (§3.2)
  return (input) => suggestCategoryViaLLM(input, sink);
}
