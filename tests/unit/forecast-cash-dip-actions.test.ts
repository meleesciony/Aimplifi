/**
 * Forecast: cash-dip actions (Calendar + Sync) without leaving (DECISIONS #714).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Forecast mounts cash-dip actions when projected below $0', () => {
  it('test_regression__household_can_act_on_forecast_cash_dip_without_leaving_for_accounts', () => {
    const page = readFileSync(resolve('src/app/(app)/forecast/page.tsx'), 'utf8');
    expect(page).toContain('forecast-cash-dip-actions');
    expect(page).toContain('forecast-cash-dip-calendar-link');
    expect(page).toContain('SyncAllButton');
    expect(page).toContain('firstNegativeDate');
    expect(page).toContain('/calendar?month=');
  });
});
