/**
 * Home chapters (#758): Adjust / Picture start closed so first paint is
 * the stage + daily loop, not the rest of the dump.
 */
import { expect, test } from './helpers/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __AIMPLIFI_E2E_KEEP_HOME_CLOSED?: boolean }).__AIMPLIFI_E2E_KEEP_HOME_CLOSED =
      true;
  });
});

test('phone Home keeps the daily loop open and Picture closed', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await expect(page.getByTestId('home-stage')).toBeVisible();
  await expect(page.getByTestId('dashboard-recent-transactions')).toBeVisible();
  await expect(page.getByTestId('today-feed-card')).toBeVisible();
  await expect(page.getByTestId('cash-flow-radar-card')).toBeVisible();

  const picture = page.getByTestId('home-chapter-home-picture');
  await expect(picture).toBeVisible();
  await expect(picture).not.toHaveAttribute('open');
  const box = await picture.boundingBox();
  expect(box, 'closed picture').toBeTruthy();
  if (!box) return;
  expect(box.height).toBeLessThan(140);

  await expect(page.getByTestId('net-worth-amount')).toBeHidden();
  await picture.locator('summary').click();
  await expect(picture).toHaveAttribute('open', '');
  await expect(page.getByTestId('net-worth-amount')).toBeVisible();
});

test('Adjust the plan starts closed and still holds the plan figures', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const adjust = page.getByTestId('home-chapter-home-adjust');
  await expect(adjust).toBeVisible();
  await expect(adjust).not.toHaveAttribute('open');
  await expect(page.getByTestId('home-plan-figures')).toBeHidden();
  await adjust.locator('summary').click();
  await expect(page.getByTestId('home-plan-figures')).toBeVisible();
});

test('a hash jump opens Picture even when the rest stay closed', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/dashboard#home-picture');

  const picture = page.getByTestId('home-chapter-home-picture');
  await expect(picture).toHaveAttribute('open', '');
  await expect(page.getByTestId('home-chapter-home-adjust')).not.toHaveAttribute('open');
  await expect(page.getByTestId('net-worth-amount')).toBeVisible();
  await expect(picture).toBeFocused();
});

test('Home chapter nav opens Picture and moves focus', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const picture = page.getByTestId('home-chapter-home-picture');
  await expect(page.getByTestId('home-chapter-nav')).toBeVisible();
  const marker = await picture.locator(':scope > summary').evaluate((el) => getComputedStyle(el).listStyleType);
  expect(marker).toMatch(/disclosure|disc/);

  await page.getByTestId('home-chapter-nav').getByRole('link', { name: 'The picture' }).click();
  await expect(picture).toHaveAttribute('open', '');
  await expect(page.getByTestId('home-chapter-home-adjust')).not.toHaveAttribute('open');
  await expect(page.getByTestId('net-worth-amount')).toBeVisible();
  await expect(picture).toBeFocused();
});
