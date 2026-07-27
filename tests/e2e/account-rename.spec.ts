/**
 * Account rename (TASKS L.7) — UI round-trip on /accounts (380×800).
 *
 * Owner-requested: *"there should be a way to edit name of accounts myself."* This spec walks
 * the whole control the way he will: open the box on a row, type a name, save, see the row
 * renamed and the sort order follow the new name, then clear the box and watch the original
 * name come back.
 *
 * Isolation (the manual-card-statement.spec convention): a THROWAWAY signed-up user, never the
 * shared demo — the demo's account names are read by golden assertions in other specs, and the
 * rename action is demo-fenced server-side anyway.
 *
 * Post-reload clicks use the click-and-verify retry (#167 critic P1): the reliable-mutation
 * recipe confirms each write with window.location.reload(), and the first click after a reload
 * can land on pre-hydration HTML, which React does not replay.
 */
import { expect, test } from './helpers/test';

test('rename a manual account, then clear the name to get the original back', async ({ page }) => {
  const email = `e2e-rename-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 20000 });

  // Two liabilities whose names sort in a known order, so the re-sort after the rename is
  // observable rather than asserted on a single row that cannot move.
  for (const [name, value] of [
    ['E2E Alpha Card', '100'],
    ['E2E Zulu Card', '200'],
  ] as const) {
    await page.getByTestId('add-liability-btn').click();
    await page.getByTestId('manual-name').fill(name);
    await page.getByTestId('manual-type').selectOption('CREDIT');
    await page.getByTestId('manual-value').fill(value);
    await page.getByTestId('manual-submit').click();
    await expect(page.getByTestId('manual-account-row').filter({ hasText: name })).toBeVisible({
      timeout: 20000,
    });
  }

  const rows = page.getByTestId('manual-account-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('E2E Alpha Card');

  // Open the name box on the FIRST row. Hydration retry: re-click until the input appears.
  const alpha = () => page.getByTestId('manual-account-row').filter({ hasText: 'E2E Alpha Card' });
  await expect(async () => {
    await alpha().getByTestId('account-rename').click({ timeout: 2000 });
    await expect(page.getByTestId('account-rename-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });

  // The helper line states the rule and the escape hatch before he commits to anything.
  await expect(page.getByTestId('account-rename-form')).toContainText('Leave the box empty');

  // A name chosen to sort AFTER the other row, so the re-sort is observable: the list is
  // ordered by the label on screen, not by the string still sitting in the database.
  await page.getByTestId('account-rename-input').fill('E2E Zzz Renamed Card');
  await page.getByTestId('account-rename-save').click();

  // The reload IS the confirmation: the row now carries the new name and nothing carries the old.
  await expect(
    page.getByTestId('manual-account-row').filter({ hasText: 'E2E Zzz Renamed Card' }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Alpha Card' })).toHaveCount(0);
  await expect(page.getByTestId('manual-account-row').first()).toContainText('E2E Zulu Card');
  await expect(page.getByTestId('manual-account-row').last()).toContainText('E2E Zzz Renamed Card');

  // Clearing the box restores the name the row was created with — and its old sort position.
  const renamed = () => page.getByTestId('manual-account-row').filter({ hasText: 'E2E Zzz Renamed Card' });
  await expect(async () => {
    await renamed().getByTestId('account-rename').click({ timeout: 2000 });
    await expect(page.getByTestId('account-rename-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('account-rename-input').fill('');
  await page.getByTestId('account-rename-save').click();

  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Alpha Card' })).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByTestId('manual-account-row').filter({ hasText: 'E2E Zzz Renamed Card' }),
  ).toHaveCount(0);
  await expect(page.getByTestId('manual-account-row').first()).toContainText('E2E Alpha Card');
});
