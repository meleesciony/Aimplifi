/**
 * Forget learned phrases from Trust without leaving for Settings/Ask (DECISIONS #705).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Trust mounts LearnedPhrases', () => {
  it('test_regression__household_can_forget_learned_phrases_from_trust_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/trust/page.tsx'), 'utf8');
    expect(page).toContain('LearnedPhrases');
    expect(page).toContain('trust-learned-phrases-card');
    expect(page).toContain('listLearnedPhrases');
    const actions = readFileSync(resolve('src/server/vocab-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/trust')");
  });
});
