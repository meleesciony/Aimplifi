/**
 * Settings Fixed card: edit reserves without leaving for Spending plan (DECISIONS #680).
 *
 * ReserveNameControl / ReserveCostControl / ReserveCadenceControl / DeleteReserveButton
 * lived on the Spending plan reserves section. Settings Fixed only showed the
 * monthly figure + add form, so changing an existing reserve required leaving.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Settings Fixed card reuses reserve writers', () => {
  it('test_regression__household_can_edit_reserves_on_settings_fixed_without_leaving_for_spending_plan', () => {
    const src = readFileSync(resolve('src/components/settings/fixed-costs-card.tsx'), 'utf8');
    expect(src).toContain('ReserveNameControl');
    expect(src).toContain('ReserveCostControl');
    expect(src).toContain('ReserveCadenceControl');
    expect(src).toContain('DeleteReserveButton');
    expect(src).toContain('reserves-setup-list');
    expect(src).toContain('reserve-setup-row');
    expect(src).toContain('canWrite');
    expect(src).toContain('reserveLines');

    const list = src.indexOf('data-testid="reserves-setup-list"');
    expect(list).toBeGreaterThan(-1);
    const around = src.slice(list, list + 2500);
    expect(around).toContain('<ReserveNameControl');
    expect(around).toContain('<ReserveCostControl');
    expect(around).toContain('<ReserveCadenceControl');
    expect(around).toContain('<DeleteReserveButton');

    // Refused rows can be removed here too (not only on Spending plan).
    const refused = src.indexOf('data-testid="reserves-refused-card"');
    expect(refused).toBeGreaterThan(-1);
    expect(src.slice(refused, refused + 1800)).toContain('<DeleteReserveButton');
  });
});
