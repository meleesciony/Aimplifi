/**
 * Push notifications from Forecast without leaving for Settings (DECISIONS #709).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Forecast mounts PushOptIn', () => {
  it('test_regression__household_can_enable_push_notifications_from_forecast_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/forecast/page.tsx'), 'utf8');
    expect(page).toContain('PushOptIn');
    expect(page).toContain('forecast-notifications-card');
    expect(page).toContain('getVapidPublicKey');
  });
});
