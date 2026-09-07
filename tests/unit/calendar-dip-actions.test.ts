/**
 * Calendar: cash-dip actions (Forecast link + Sync) on the shortfall day (DECISIONS #715).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Calendar mounts cash-dip actions on the shortfall day', () => {
  it('test_regression__household_can_act_on_calendar_cash_dip_without_leaving_for_accounts', () => {
    const page = readFileSync(resolve('src/app/(app)/calendar/page.tsx'), 'utf8');
    expect(page).toContain('calendar-dip-actions');
    expect(page).toContain('calendar-dip-forecast-link');
    expect(page).toContain('SyncAllButton');
    expect(page).toContain('shortfallDate');
  });
});
