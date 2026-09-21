import { expect, type Page } from '@playwright/test';

/** This month’s second fold starts closed. The summary names room for error. */
export async function openCoachMonthRest(page: Page): Promise<void> {
  const rest = page.getByTestId('coach-month-rest');
  await expect(rest).toBeVisible();
  if ((await rest.getAttribute('open')) === null) {
    await rest.locator('> summary').click();
  }
  await expect(rest).toHaveAttribute('open', '');
}
