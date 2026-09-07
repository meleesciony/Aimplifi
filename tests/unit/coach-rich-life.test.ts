/**
 * Coach Rich Life without leaving for Settings (DECISIONS #687).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Coach mounts RichLifeForm', () => {
  it('test_regression__household_can_set_rich_life_from_coach_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('RichLifeForm');
    expect(page).toContain('coach-rich-life');
    expect(page).toContain('richLifeVision: true');

    const form = readFileSync(resolve('src/components/settings/rich-life-form.tsx'), 'utf8');
    expect(form).toContain('reloadOnSuccess');
    expect(form).toContain('updateRichLife');
  });
});
