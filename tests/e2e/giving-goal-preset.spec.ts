/**
 * Giving goal preset on /goals (DECISIONS #521 / C14 leftover).
 * The chip fills the name only — dollars stay the reader's. Demo
 * e2e reseeds, then this spec deletes the row it created.
 */
import { expect, test } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

test('goals: Giving preset fills the name and does not invent dollars', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-goals');
  await page.waitForURL('**/goals');

  const form = page.getByTestId('goal-form');
  await expect(form).toBeVisible();
  await expect(page.getByTestId('goal-preset-giving')).toBeVisible();
  await expect(page.getByTestId('goal-preset-giving')).toHaveAttribute(
    'aria-describedby',
    'goal-preset-giving-hint',
  );
  // The rendered label, not just the fill (critic P2 on #522).
  await expect(page.getByTestId('goal-preset-giving')).toHaveText('Giving');
  const hint = page.getByTestId('goal-preset-giving-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Gifts');
  await expect(hint).toContainText('Charity & Donations');
  await expect(hint).toContainText(/you type the dollars/i);
  await expect(hint).toContainText(/lens, not a grade/i);
  await expect(hint).not.toContainText(/tithe|10%|should give|generously|Coast/i);

  await page.getByTestId('goal-preset-giving').click();
  await expect(form.locator('input[name="name"]')).toHaveValue('Giving');
  await expect(form.locator('input[name="target"]')).toHaveValue('');
  await expect(form.locator('input[name="monthly"]')).toHaveValue('');
  await expect(form.locator('input[name="target"]')).toBeFocused();
  await expect(
    page.getByTestId('goals-list').getByRole('heading', { name: 'Giving', exact: true }),
  ).toHaveCount(0);

  await form.locator('input[name="target"]').fill('1000');
  await form.locator('input[name="monthly"]').fill('100');
  await page.getByTestId('goal-create').click();

  // Scoped to the list: `goal-form` / `goal-preset-giving` / the hint all
  // start with `goal-` and contain the word Giving.
  const card = page.getByTestId('goals-list').locator('[data-slot="card"]').filter({
    has: page.getByRole('button', { name: 'Rename Giving' }),
  });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('goal-fi-impact')).toContainText('Funded in ~10 months');

  const confirmBtn = card.getByTestId('goal-delete-confirm');
  await expect(async () => {
    if ((await confirmBtn.count()) === 0) {
      await card.getByRole('button', { name: 'Delete Giving' }).click({ timeout: 2000 });
    }
    await expect(confirmBtn).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await confirmBtn.click();
  await expect(card).toHaveCount(0);
});
