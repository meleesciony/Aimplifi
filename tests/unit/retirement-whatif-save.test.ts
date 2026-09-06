/**
 * Investments retirement what-if can save as default without leaving for Settings
 * (DECISIONS #685).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Retirement what-if save on Investments', () => {
  it('test_regression__household_can_save_retirement_whatif_as_default_without_leaving_for_settings', () => {
    const card = readFileSync(resolve('src/components/finance/retirement-outlook-card.tsx'), 'utf8');
    expect(card).toContain('saveRetirementWhatIfDefaults');
    expect(card).toContain('retirement-whatif-save');
    expect(card).toContain('canWrite');
    expect(card).not.toMatch(/Make it your default[\s\S]{0,80}href="\/settings"/);

    const actions = readFileSync(resolve('src/server/settings-actions.ts'), 'utf8');
    expect(actions).toContain('export async function saveRetirementWhatIfDefaults');
    expect(actions).toContain("source: 'investments-whatif'");

    const page = readFileSync(resolve('src/app/(app)/investments/page.tsx'), 'utf8');
    expect(page).toContain('canWrite={!isDemoUser(userId)}');
  });
});
