/**
 * Cards page add-card (DECISIONS #637). A household with a bank account but
 * no cards used to be sent to Accounts to type one. This spec adds the card
 * FROM /cards and asserts it lands in “No due date yet”. Isolation: throwaway
 * user, not demo. First clicks after a reload retry until the form reacts
 * (hydration barrier; see tests/e2e/manual-card-statement.spec.ts).
 */
import { execSync } from 'node:child_process';
import { expect, test } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

test('add a manual card from Cards without opening Accounts', async ({ page }) => {
  const email = `e2e-cards-add-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  execSync(`npx tsx scripts/e2e-add-foreign-account.ts ${email} --usd-only`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  await page.goto('/cards');
  const empty = page.getByTestId('cards-empty');
  await expect(empty).toBeVisible({ timeout: 20000 });
  await expect(empty.getByTestId('cards-empty-manual')).toBeVisible();

  await expect(async () => {
    await empty.getByTestId('cards-empty-manual').click({ timeout: 2000 });
    await expect(empty.getByTestId('cards-add-form')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });

  await expect(page).toHaveURL(/\/cards/);
  await empty.getByTestId('cards-add-name').fill('E2E Cards Add');
  await empty.getByTestId('cards-add-value').fill('500');
  await empty.getByTestId('cards-add-save').click();

  const unknown = page.getByTestId('cards-unknown-due');
  await expect(unknown).toBeVisible({ timeout: 20000 });
  await expect(unknown).toContainText('E2E Cards Add');
  await expect(page.getByTestId('cards-empty')).toHaveCount(0);
  await expect(page.getByTestId('cards-add-open')).toBeVisible();
});
