/**
 * W.6(b) follow-up: employer-match Settings rung. Real-user write path AND
 * the shared-demo fence, both driven through the browser.
 */
import { expect, test } from './helpers/test';

test('a real user saves an uncaptured match and Coach ranks it first', async ({ page }) => {
  const email = `e2e-ematch-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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
  await expect(page.getByTestId('next-dollar-skipped')).toContainText('Settings');
  await page.getByTestId('investing-ladder').locator('summary').click();
  await expect(page.getByTestId('investing-ladder-steps')).toContainText(
    "we don't yet know whether you have a match",
  );

  await page.goto('/settings');
  await page.getByTestId('employer-match-uncaptured').check();
  await page.getByTestId('employer-match-save').click();
  await expect(page.getByTestId('employer-match-saved')).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByTestId('employer-match-uncaptured')).toBeChecked();

  await page.goto('/coach');
  await expect(page.getByTestId('next-dollar-headline')).toContainText('the employer match', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('next-dollar-why')).toContainText('Settings');
  await expect(page.getByTestId('next-dollar-skipped')).not.toContainText('Employer match is skipped');
  await expect(page.getByTestId('next-dollar-skipped')).not.toContainText("Employer match isn't on file");
  await page.getByTestId('investing-ladder').locator('summary').click();
  await expect(page.getByTestId('investing-ladder-steps')).not.toContainText(
    "we don't yet know whether you have a match",
  );
});

test('the shared demo cannot write a match status and Coach still skips the rung', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });

  await page.goto('/settings');
  await expect(page.getByTestId('employer-match-demo-note')).toBeVisible();
  await expect(page.getByTestId('employer-match-form')).toHaveCount(0);

  await page.goto('/coach');
  await expect(page.getByTestId('next-dollar-headline')).toContainText('investing');
  await expect(page.getByTestId('next-dollar-skipped')).toContainText('Settings');
});
