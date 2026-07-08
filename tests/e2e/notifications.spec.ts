/**
 * Proactive notifications (Gap 2 §2) — the cron gate, the subscribe-endpoint auth
 * gate, and the dormant invariant in the UI: with no VAPID keys the demo /settings
 * page shows NO notifications card (nothing a user could opt into), so the seeded demo
 * is unchanged. Live push delivery needs real VAPID keys + a real push service and is
 * proven at the unit/integration level (push.test.ts, cron-notify.test.ts).
 */
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('notify cron route requires the secret', async ({ browser }) => {
  const fresh = await browser.newContext();
  const anon = await fresh.newPage();
  const res = await anon.request.get('/api/cron/notify');
  expect(res.status()).toBe(401);
  await fresh.close();
});

test('push subscribe endpoint rejects an unauthenticated request', async ({ browser }) => {
  const fresh = await browser.newContext();
  const anon = await fresh.newPage();
  const res = await anon.request.post('/api/push/subscribe', {
    data: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
  });
  expect(res.status()).toBe(401);
  await fresh.close();
});

test('demo settings shows no notifications card (dormant without VAPID)', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // The rest of settings renders...
  await expect(page.getByTestId('privacy-card')).toBeVisible();
  // ...but the notifications opt-in is gated on VAPID config → hidden in the demo.
  await expect(page.getByTestId('notifications-card')).toHaveCount(0);
});
