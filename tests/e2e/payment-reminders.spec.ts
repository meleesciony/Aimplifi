/**
 * Payment reminders (ROADMAP #6) — the in-app surface + the cron mechanism's gate.
 * The dashboard shows upcoming card payments (derived from the same obligations as
 * the headline), and the reminder cron route is secret-guarded like sync.
 */
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('dashboard surfaces upcoming card payments', async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId('payment-reminders-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Payment reminders');
  // The seed has cards due this cycle → at least one reminder row.
  await expect(page.getByTestId('reminder-row').first()).toBeVisible();

  // No card is listed twice (the cards/upcoming overlap double-count is fixed).
  const names = await page.getByTestId('reminder-card-name').allInnerTexts();
  expect(names.length).toBeGreaterThanOrEqual(1);
  expect(new Set(names).size).toBe(names.length);

  // The seed Auto Loan now surfaces here too (#134): loan payments share the reminders
  // surface with cards, while the cash-needed dollar headline stays card-only.
  await expect(card).toContainText('Auto Loan');
});

test('reminder cron route requires the secret', async ({ browser }) => {
  const fresh = await browser.newContext();
  const anon = await fresh.newPage();
  const res = await anon.request.get('/api/cron/reminders');
  expect(res.status()).toBe(401);
  await fresh.close();
});
