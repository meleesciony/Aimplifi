/**
 * Coach: edit already-saved on savings goals without leaving for Goals (DECISIONS #716).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Coach mounts GoalSavedControl for ordinary savings goals', () => {
  it('test_regression__household_can_edit_already_saved_from_coach_without_leaving_for_goals', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('GoalSavedControl');
    expect(page).toContain('coach-goals-saved-card');
    expect(page).toContain("kind: null");
    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/coach')");
  });
});
