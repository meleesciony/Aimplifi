import { describe, expect, it, vi } from 'vitest';
import { assistUnsureRows, type AssistableRow } from '@/server/categorize-assist';
import type { LlmCategory } from '@/lib/engine/categorize/llm';

const confident: AssistableRow = {
  rawDescriptor: 'STARBUCKS',
  amountCents: -500,
  categoryId: 'dining',
  confidenceBps: 9500,
  needsReview: false,
};
const unsure = (desc: string): AssistableRow => ({
  rawDescriptor: desc,
  amountCents: -1500,
  categoryId: 'uncategorized',
  confidenceBps: 4000,
  needsReview: true,
});

describe('assistUnsureRows — LLM auto-apply at ingest (DECISIONS #42)', () => {
  it('auto-files a confident LLM pick for an unsure row, leaving confident rows untouched', async () => {
    const suggest = vi.fn(async (): Promise<LlmCategory> => ({ categoryId: 'software', confidenceBps: 9000 }));
    const out = await assistUnsureRows([confident, unsure('FIGMA MONTHLY')], suggest);
    expect(out[0]).toEqual(confident); // pipeline-confident row is never LLM-touched
    expect(out[1]).toMatchObject({ categoryId: 'software', confidenceBps: 9000, needsReview: false });
    expect(suggest).toHaveBeenCalledTimes(1); // only the unsure row triggers a call
  });

  it('dedupes LLM calls per descriptor', async () => {
    const suggest = vi.fn(async (): Promise<LlmCategory> => ({ categoryId: 'software', confidenceBps: 9000 }));
    const out = await assistUnsureRows([unsure('FIGMA'), unsure('FIGMA'), unsure('NOTION')], suggest);
    expect(suggest).toHaveBeenCalledTimes(2); // FIGMA once + NOTION once, not 3
    expect(out.every((r) => !r.needsReview)).toBe(true);
  });

  it('leaves a row in review when the LLM returns null (no key) or is not confident', async () => {
    const noKey = await assistUnsureRows([unsure('X')], async () => null);
    expect(noKey[0]).toMatchObject({ categoryId: 'uncategorized', needsReview: true });
    const lowConf = await assistUnsureRows([unsure('Y')], async () => ({ categoryId: 'software', confidenceBps: 5000 }));
    expect(lowConf[0]).toMatchObject({ needsReview: true });
  });

  it('makes no calls when nothing is unsure', async () => {
    const suggest = vi.fn(async (): Promise<LlmCategory | null> => null);
    const out = await assistUnsureRows([confident], suggest);
    expect(suggest).not.toHaveBeenCalled();
    expect(out).toEqual([confident]);
  });
});
