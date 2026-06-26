'use server';

/**
 * Backfill categorization action (DECISIONS #116; LLM second pass #117). Thin
 * 'use server' wrapper: resolve the session, then delegate to the testable core
 * with the REAL provider (suggestCategoryViaLLM — xAI/Anthropic if a key is set,
 * else a null no-op). All logic, both passes, and the ownership-scoped writes live
 * in src/server/backfill.ts so they're unit-testable with an injected LLM stub and
 * no auth mock.
 */
import { requireUserId } from '@/server/authz';
import { runBackfillForUser, type BackfillResult } from '@/server/backfill';
import { suggestCategoryViaLLM } from '@/server/llm-categorize';

export async function backfillCategorization(): Promise<BackfillResult> {
  const userId = await requireUserId();
  return runBackfillForUser(userId, suggestCategoryViaLLM);
}
