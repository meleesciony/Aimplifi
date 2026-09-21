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

  await expect(page.getByTestId('net-worth-amount')).not.toBeAttached();
  await picture.locator(':scope > summary').click();
  await expect(picture).toHaveAttribute('open', '');
  await expect(page.getByTestId('net-worth-amount')).toBeVisible();
  expect(
    await picture.evaluate(
      (el) => el.hasAttribute('open') && Boolean(el.querySelector('[data-testid="net-worth-amount"]')),
    ),
  ).toBe(true);
  expect(
    await picture.evaluate((el) => {
      const summary = el.querySelector(':scope > summary');
      if (!(summary instanceof HTMLElement)) return false;
      summary.click();
      return el.hasAttribute('open') && Boolean(el.querySelector('[data-testid="net-worth-amount"]'));
    }),
  ).toBe(true);
});

test('Adjust the plan starts closed and still holds the plan figures', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const adjust = page.getByTestId('home-chapter-home-adjust');
  await expect(adjust).toBeVisible();
  await expect(adjust).not.toHaveAttribute('open');
  await expect(page.getByTestId('home-plan-figures')).not.toBeAttached();
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

test('first-open Enter keeps a Home chapter open', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const picture = page.getByTestId('home-chapter-home-picture');
  await expect(picture).not.toHaveAttribute('open');
  await expect(page.getByTestId('net-worth-amount')).not.toBeAttached();

  await picture.locator(':scope > summary').press('Enter');
  await expect(picture).toHaveAttribute('open', '');
  await expect(page.getByTestId('net-worth-amount')).toBeVisible();
  expect(
    await picture.evaluate(
      (el) => el.hasAttribute('open') && Boolean(el.querySelector('[data-testid="net-worth-amount"]')),
    ),
  ).toBe(true);

  await picture.locator(':scope > summary').click();
  await expect(picture).not.toHaveAttribute('open');
});

test('Space on a closed Home chapter opens with the body already there', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const picture = page.getByTestId('home-chapter-home-picture');
  await expect(picture).not.toHaveAttribute('open');
  await expect(page.getByTestId('net-worth-amount')).not.toBeAttached();

  await picture.locator(':scope > summary').press('Space');
  await expect(picture).toHaveAttribute('open', '');
  await expect(page.getByTestId('net-worth-amount')).toBeVisible();
  expect(
    await picture.evaluate(
      (el) => el.hasAttribute('open') && Boolean(el.querySelector('[data-testid="net-worth-amount"]')),
    ),
  ).toBe(true);

  await picture.locator(':scope > summary').click();
  await expect(picture).not.toHaveAttribute('open');
  await picture.locator(':scope > summary').press('Enter');
  await expect(picture).toHaveAttribute('open', '');
  await expect(page.getByTestId('net-worth-amount')).toBeVisible();

  const adjust = page.getByTestId('home-chapter-home-adjust');
  await expect(adjust).not.toHaveAttribute('open');
  await expect(page.getByTestId('home-plan-figures')).not.toBeAttached();
  expect(
    await adjust.evaluate((el) => {
      const details = el as HTMLDetailsElement;
      details.open = true;
      return Promise.resolve().then(() => {
        const summary = details.querySelector('summary');
        if (!(summary instanceof HTMLElement)) return false;
        const afterAdopt =
          details.open && Boolean(details.querySelector('[data-testid="home-plan-figures"]'));
        summary.click();
        const afterLeftover =
          details.open && Boolean(details.querySelector('[data-testid="home-plan-figures"]'));
        summary.click();
        return afterAdopt && afterLeftover && !details.open;
      });
    }),
  ).toBe(true);
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
