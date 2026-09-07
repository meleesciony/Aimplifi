/**
 * Household membership from Coach without leaving for Settings (DECISIONS #694).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Coach mounts HouseholdCard', () => {
  it('test_regression__household_can_manage_household_membership_from_coach_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('HouseholdCard');
    expect(page).toContain('coach-household-card');
    expect(page).toContain('getHouseholdView');
    const actions = readFileSync(resolve('src/server/household-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/coach')");
  });
});
