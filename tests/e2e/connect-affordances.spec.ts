/**
 * Inline connect/add affordances (2026-07-21 agent review A1 + A2): a user WITH
 * accounts but NO credit cards must not be dead-ended to prose on /cards — the
 * real Plaid connect button and add/import affordances render right in the
 * empty state — and the Settings "Bank connections" card carries the same live
 * button instead of being decorative. Fixture: the guarded --usd-only helper
 * (one USD checking account, zero credit cards) from currency-disclosure.spec.ts.
 * Visibility only — clicking connect would hit Plaid, which e2e never configures.
 */
import { execSync } from 'node:child_process';
import { expect, test } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

test('cards empty state and settings connections card offer live connect affordances', async ({ page }) => {
  const email = `e2e-cards-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  // Ad-hoc real signup (tests/e2e/auth.spec.ts pattern) — lands on empty onboarding.
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();

  execSync(`npx tsx scripts/e2e-add-foreign-account.ts ${email} --usd-only`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  // /cards: has an account, no credit cards → the no-cards branch (NOT the
  // zero-account EmptyDashboard) offers the real affordances inline (A1).
  await page.goto('/cards');
  const empty = page.getByTestId('cards-empty');
  await expect(empty).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toHaveCount(0);
  await expect(empty.getByTestId('connect-bank-btn')).toBeVisible();
  await expect(empty.getByTestId('cards-empty-import')).toBeVisible();

  // "Add a card manually" opens the form on Cards — same writer as Accounts,
  // type locked to CREDIT (DECISIONS #637). Do not leave /cards.
  await expect(async () => {
    await empty.getByTestId('cards-empty-manual').click({ timeout: 2000 });
    await expect(empty.getByTestId('cards-add-form')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await expect(page).toHaveURL(/\/cards/);

  // /settings: the Bank-connections card is live, not decorative (A2).
  await page.goto('/settings');
  const card = page.getByTestId('connections-card');
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card.getByTestId('connect-bank-btn')).toBeVisible();
  await expect(card.getByTestId('settings-manage-connections')).toBeVisible();
});
