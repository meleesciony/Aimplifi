/**
 * Push notifications from Cards without leaving for Settings (DECISIONS #697).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Cards mounts PushOptIn', () => {
  it('test_regression__household_can_enable_push_notifications_from_cards_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/cards/page.tsx'), 'utf8');
    expect(page).toContain('PushOptIn');
    expect(page).toContain('cards-notifications-card');
    expect(page).toContain('getVapidPublicKey');
  });
});
