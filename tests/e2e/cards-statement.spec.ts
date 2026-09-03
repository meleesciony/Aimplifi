/**
 * Cards page statement add (DECISIONS #634). A hand-added CREDIT card with no
 * statement lands in “No due date yet” and used to name Accounts as the only
 * writer. This spec attaches the statement FROM /cards and asserts the card
 * leaves that panel. Isolation: throwaway user, not demo.
 *
 * Dates are fixed (close 2026-09-01, due 2026-09-20): the parser only requires
 * due > close. First clicks after a reload retry until the form reacts
 * (hydration barrier; see tests/e2e/manual-card-statement.spec.ts).
 */
import { expect, test } from './helpers/test';

test('add a statement to a manual card from Cards without opening Accounts', async ({ page }) => {
  const email = `e2e-cards-stmt-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('add-liability-btn').click();
  await page.getByTestId('manual-name').fill('E2E Cards Stmt');
  await page.getByTestId('manual-type').selectOption('CREDIT');
  await page.getByTestId('manual-value').fill('500');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Cards Stmt' })).toBeVisible({
    timeout: 20000,
  });

  await page.goto('/cards');
  const unknown = page.getByTestId('cards-unknown-due');
  await expect(unknown).toBeVisible({ timeout: 20000 });
  await expect(unknown).toContainText('E2E Cards Stmt');
  await expect(unknown.getByTestId('card-row-statement-add')).toBeVisible();

  await expect(async () => {
    await unknown.getByTestId('card-row-statement-add').click({ timeout: 2000 });
    await expect(unknown.getByTestId('card-statement-form')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });

  await unknown.getByTestId('cs-balance').fill('1200');
  await unknown.getByTestId('cs-min').fill('35');
  await unknown.getByTestId('cs-close').fill('2026-09-01');
  await unknown.getByTestId('cs-due').fill('2026-09-20');
  await unknown.getByTestId('cs-save').click();

  await expect(page.getByTestId('cards-unknown-due')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByTestId('card-row-name')).toHaveText('E2E Cards Stmt');
  await expect(page.getByTestId('do-this-first')).toContainText('E2E Cards Stmt');
  await expect(page.getByTestId('card-row-statement-add')).toHaveCount(0);
});
