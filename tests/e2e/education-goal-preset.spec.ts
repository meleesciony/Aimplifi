/**
 * Education goal preset on /goals (DECISIONS #522 / the last C14 leftover).
 * The chip fills the name only — dollars stay the reader's. Demo e2e
 * reseeds, then this spec deletes the row it created.
 *
 * Locators are scoped to `goals-list` with an exact heading (the #521 critic
 * P1): `goal-form`, `goal-preset-education` and its hint all start with
 * `goal-` and contain the word Education.
 */
import { expect, test } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

test('goals: Education preset fills the name and does not invent dollars', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-goals');
  await page.waitForURL('**/goals');

  const form = page.getByTestId('goal-form');
  await expect(form).toBeVisible();
  await expect(page.getByTestId('goal-preset-education')).toBeVisible();
  await expect(page.getByTestId('goal-preset-education')).toHaveAttribute(
    'aria-describedby',
    'goal-preset-education-hint',
  );
  // Both chips render; adding one did not replace the shipped one.
  await expect(page.getByTestId('goal-preset-giving')).toBeVisible();
  // The RENDERED label, not just the fill (critic P2). Swapping the two
  // `label:` entries in the form's PRESET_COPY leaves every other assertion
  // in this repo green: the name input is filled from the engine registry,
  // so only the chip's own text catches a copy wired to the wrong preset.
  await expect(page.getByTestId('goal-preset-education')).toHaveText('Education');
  await expect(page.getByTestId('goal-preset-giving')).toHaveText('Giving');

  const hint = page.getByTestId('goal-preset-education-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Tuition');
  await expect(hint).toContainText('Student Loan');
  await expect(hint).toContainText(/you type the dollars/i);
  await expect(hint).toContainText(/is a debt, not this envelope/i);
  // Giving's lens clause belongs to Giving alone — /reports has no education figure.
  await expect(hint).not.toContainText(/lens, not a grade/i);
  await expect(hint).not.toContainText(/529|tax-advantaged|scholarship|retirement|Coast/i);

  await page.getByTestId('goal-preset-education').click();
  await expect(form.locator('input[name="name"]')).toHaveValue('Education');
  await expect(form.locator('input[name="target"]')).toHaveValue('');
  await expect(form.locator('input[name="monthly"]')).toHaveValue('');
  await expect(form.locator('input[name="target"]')).toBeFocused();
  await expect(
    page.getByTestId('goals-list').getByRole('heading', { name: 'Education', exact: true }),
  ).toHaveCount(0);

  await form.locator('input[name="target"]').fill('1200');
  await form.locator('input[name="monthly"]').fill('100');
  await page.getByTestId('goal-create').click();

  const card = page.getByTestId('goals-list').locator('[data-slot="card"]').filter({
    has: page.getByRole('button', { name: 'Rename Education' }),
  });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('goal-fi-impact')).toContainText('Funded in ~12 months');

  const confirmBtn = card.getByTestId('goal-delete-confirm');
  await expect(async () => {
    if ((await confirmBtn.count()) === 0) {
      await card.getByRole('button', { name: 'Delete Education' }).click({ timeout: 2000 });
    }
    await expect(confirmBtn).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await confirmBtn.click();
  await expect(card).toHaveCount(0);
});
