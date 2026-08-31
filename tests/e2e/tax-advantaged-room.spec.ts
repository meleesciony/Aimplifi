/**
 * W.6(b) follow-up: tax-advantaged contribution-room Settings rung. Real-user
 * write path AND the shared-demo fence, both driven through the browser.
 */
import { expect, test } from './helpers/test';

test('a real user saves remaining room and Coach ranks it after debts and runway', async ({
  page,
}) => {
  const email = `e2e-taxroom-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  await page.goto('/accounts');
  await page.getByTestId('add-asset-btn').click();
  await page.getByTestId('manual-name').fill('Primary home');
  await page.getByTestId('manual-value').fill('100000');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row')).toBeVisible({ timeout: 20_000 });

  await page.goto('/coach');
  await expect(page.getByTestId('next-dollar-headline')).toContainText('investing');
  await expect(page.getByTestId('next-dollar-skipped')).toContainText('Tax-advantaged contribution room isn');
  await expect(page.getByTestId('next-dollar-skipped')).toContainText('Settings');

  await page.goto('/settings');
  await page.getByTestId('tax-advantaged-room-remaining').check();
  await page.getByTestId('tax-advantaged-room-save').click();
  await expect(page.getByTestId('tax-advantaged-room-saved')).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByTestId('tax-advantaged-room-remaining')).toBeChecked();

  await page.goto('/coach');
  await expect(page.getByTestId('next-dollar-headline')).toContainText(
    'tax-advantaged contribution room',
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('next-dollar-why')).toContainText('Settings');
  await expect(page.getByTestId('next-dollar-why')).not.toContainText(/Roth|529|HSA|Traditional/i);
  await expect(page.getByTestId('next-dollar-skipped')).not.toContainText(
    'Tax-advantaged contribution room isn',
  );
});

test('the shared demo cannot write contribution-room status and Coach still skips the rung', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });

  await page.goto('/settings');
  await expect(page.getByTestId('tax-advantaged-room-demo-note')).toBeVisible();
  await expect(page.getByTestId('tax-advantaged-room-form')).toHaveCount(0);

  await page.goto('/coach');
  await expect(page.getByTestId('next-dollar-headline')).toContainText('investing');
  await expect(page.getByTestId('next-dollar-skipped')).toContainText('Tax-advantaged contribution room isn');
  await expect(page.getByTestId('next-dollar-skipped')).toContainText('Settings');
});
