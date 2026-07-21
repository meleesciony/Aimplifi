import 'server-only';

/**
 * The ONE way a call site obtains an LLM statement-extract function (the
 * fence-by-construction lesson; pattern of categorize-suggest.ts, #242 critic
 * cycle-2 F1/F5). Centralizing the demo fence + audit sink means every caller
 * — today the card-actions draft action, tomorrow anything else — gets both by
 * construction, and one executed test covers the fence for all of them.
 *
 * Demo fence: the shared demo account never consults a provider — even on a
 * keyed deployment — so a visitor's pasted statement text can never leave the
 * machine, and the Trust Center's demo copy stays an enforced invariant. The
 * null extract is exactly the keyless behavior: the form stays manual.
 */
import type { LlmFieldSpan } from '@/lib/engine/doc-extract/statement';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { aiAuditSink } from '@/server/ai-audit';
import { extractStatementViaLLM } from '@/server/llm-statement-extract';

export type StatementExtract = (input: { scrubbedText: string }) => Promise<LlmFieldSpan[] | null>;

export function statementExtractFor(userId: string): StatementExtract {
  if (userId === DEMO_USER_ID) return async () => null;
  const sink = aiAuditSink(userId, 'extract'); // Trust Center trail (§3.2)
  return (input) => extractStatementViaLLM(input, sink);
}
