/**
 * Push notifications from Home without leaving for Settings (DECISIONS #700).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home mounts PushOptIn', () => {
  it('test_regression__household_can_enable_push_notifications_from_home_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('PushOptIn');
    expect(page).toContain('home-notifications-card');
    expect(page).toContain('getVapidPublicKey');
  });
});
