/**
 * Coach employer match + tax-advantaged room without leaving for Settings
 * (DECISIONS #686).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Coach mounts employer match and tax-advantaged room', () => {
  it('test_regression__household_can_set_employer_match_and_tax_room_from_coach_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('EmployerMatchForm');
    expect(page).toContain('TaxAdvantagedRoomForm');
    expect(page).toContain('coach-employer-match');
    expect(page).toContain('coach-tax-advantaged-room');
    expect(page).toContain('employerMatch: true');
    expect(page).toContain('taxAdvantagedRoom: true');

    const match = readFileSync(resolve('src/components/settings/employer-match-form.tsx'), 'utf8');
    expect(match).toContain('reloadOnSuccess');
    expect(match).toContain('updateEmployerMatch');

    const room = readFileSync(resolve('src/components/settings/tax-advantaged-room-form.tsx'), 'utf8');
    expect(room).toContain('reloadOnSuccess');
    expect(room).toContain('updateTaxAdvantagedRoom');
  });
});
