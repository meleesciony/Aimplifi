/**
 * P1.3 "My Rich Life" vision (C.13 · Sethi): the stored line, saved on
 * /settings, echoed atop /coach. Real-user write path AND the shared-demo
 * fence, both driven through the browser — the demo note exists to prove the
 * fence, the signup test to prove the write truly renders.
 */
import { expect, test } from './helpers/test';

test('a real user saves a Rich Life line and the FI Coach echoes it', async ({ page }) => {
  const email = `e2e-richlife-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';
  const vision = 'Three months of travel every year with the family';

  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // An account must exist for /coach to render the coach (not the empty state).
  await page.goto('/accounts');
  await page.getByTestId('add-asset-btn').click();
  await page.getByTestId('manual-name').fill('Primary home');
  await page.getByTestId('manual-value').fill('100000');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row')).toBeVisible({ timeout: 20000 });

  // No echo before a vision exists.
  await page.goto('/coach');
  await expect(page.getByTestId('rich-life-vision')).toHaveCount(0);

  // Save the line on Settings (fence is off for a real user).
  await page.goto('/settings');
  await page.getByTestId('rich-life-input').fill(vision);
  await page.getByTestId('rich-life-save').click();
  await expect(page.getByTestId('rich-life-saved')).toBeVisible({ timeout: 20000 });

  // The value persisted across a reload…
  await page.reload();
  await expect(page.getByTestId('rich-life-input')).toHaveValue(vision);

  // …and the FI Coach echoes it inside the one registered sentence.
  await page.goto('/coach');
  const line = page.getByTestId('rich-life-vision');
  await expect(line).toBeVisible({ timeout: 20000 });
  await expect(line).toContainText(
    `Your Rich Life: "${vision}". Every number about your money below is in service of that — not the other way around.`,
  );
});

test('the shared demo cannot write a Rich Life line and never shows one', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  await page.goto('/settings');
  await expect(page.getByTestId('rich-life-demo-note')).toBeVisible();
  await expect(page.getByTestId('rich-life-input')).toHaveCount(0);

  await page.goto('/coach');
  await expect(page.getByTestId('rich-life-vision')).toHaveCount(0);
});
