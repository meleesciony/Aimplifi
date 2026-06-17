/**
 * LLM auto-apply at ingest (DECISIONS #42). For rows the deterministic pipeline
 * was UNSURE about (routed to review / uncategorized), ask the LLM and, when it
 * returns a confident valid category, auto-file it instead of sending it to the
 * review queue — driving manual categorization toward zero.
 *
 * The LLM call is INJECTED (not imported) so this is unit-testable without a
 * network or key; production passes suggestCategoryViaLLM (no key → null → rows
 * unchanged, preserving the demo). Calls are deduped per descriptor and made
 * only for unsure rows, so cost stays bounded to the long tail.
 */
import { type LlmCategory, pickAssistedCategory } from '@/lib/engine/categorize/llm';

export interface AssistableRow {
  rawDescriptor: string;
  amountCents: number;
  categoryId: string | null;
  confidenceBps: number | null;
  needsReview: boolean;
}

function isUnsure(r: AssistableRow): boolean {
  return r.needsReview || (r.categoryId ?? 'uncategorized') === 'uncategorized';
}

export async function assistUnsureRows<T extends AssistableRow>(
  rows: T[],
  suggest: (input: { rawDescriptor: string; amountCents: number }) => Promise<LlmCategory | null>,
): Promise<T[]> {
  const descriptors = [...new Set(rows.filter(isUnsure).map((r) => r.rawDescriptor))];
  if (descriptors.length === 0) return rows;

  const byDescriptor = new Map<string, LlmCategory | null>();
  await Promise.all(
    descriptors.map(async (d) => {
      const sample = rows.find((r) => r.rawDescriptor === d)!;
      byDescriptor.set(d, await suggest({ rawDescriptor: d, amountCents: sample.amountCents }));
    }),
  );

  return rows.map((r) => {
    if (!isUnsure(r)) return r;
    const picked = pickAssistedCategory(
      { categoryId: r.categoryId ?? 'uncategorized', confidenceBps: r.confidenceBps ?? 0, needsReview: r.needsReview },
      byDescriptor.get(r.rawDescriptor) ?? null,
    );
    if (picked.source !== 'llm') return r;
    // Don't auto-file an INFLOW (refund/credit, positive amount) as a spend
    // category — only income/transfer are sign-appropriate; else leave for
    // review so refund-netting and the user decide (#44).
    if (r.amountCents > 0 && picked.categoryId !== 'income' && picked.categoryId !== 'transfer') return r;
    return { ...r, categoryId: picked.categoryId, confidenceBps: picked.confidenceBps, needsReview: false };
  });
}
