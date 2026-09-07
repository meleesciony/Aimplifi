/**
 * Learned phrases on Ask without leaving for Settings (DECISIONS #693).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Ask mounts LearnedPhrases', () => {
  it('test_regression__household_can_forget_learned_phrases_from_ask_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/ask/page.tsx'), 'utf8');
    expect(page).toContain('LearnedPhrases');
    expect(page).toContain('ask-learned-phrases-card');
    expect(page).toContain('listLearnedPhrases');
    const actions = readFileSync(resolve('src/server/vocab-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/ask')");
  });
});
