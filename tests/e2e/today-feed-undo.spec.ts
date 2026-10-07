/**
 * DECISIONS #795 — a dismissal says so and can be undone.
 */
import { expect, test } from './helpers/test';

test('dismiss shows a confirmation with Undo; Undo brings the row back and clears the note', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const row = page.getByTestId('nudge-unused-subscription');
  await expect(row).toBeVisible();
  await page.getByTestId('nudge-dismiss-unused-subscription').click();
  await expect(row).toHaveCount(0);

  const note = page.getByTestId('today-feed-dismissed-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Possibly unused subscription');
  await expect(note).toContainText('won’t come back to Today');
  await expect(page.getByTestId('today-feed-show-all')).toContainText('Show dismissed (1)');

  await page.getByTestId('today-feed-undo').click();
  await expect(row).toBeVisible();
  await expect(note).toHaveCount(0);
  await expect(page.getByTestId('today-feed-show-all')).toHaveCount(0);
});
