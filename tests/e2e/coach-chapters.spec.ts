/**
 * Coach chapters (#757): This month, Trajectory, Habits — in that visual order.
 * Trajectory / Habits start closed so first paint is This month.
 */
import { expect, test } from './helpers/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __AIMPLIFI_E2E_KEEP_COACH_CLOSED?: boolean }).__AIMPLIFI_E2E_KEEP_COACH_CLOSED =
      true;
  });
});

test('coach chapters paint This month then Trajectory then Habits', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach');

  const now = page.getByTestId('coach-chapter-coach-now');
  const traj = page.getByTestId('coach-chapter-coach-trajectory');
  const habits = page.getByTestId('coach-chapter-coach-habits');
  await expect(now).toBeVisible();
  await expect(traj).toBeVisible();
  await expect(habits).toBeVisible();
  const n = await now.boundingBox();
  const t = await traj.boundingBox();
  const h = await habits.boundingBox();
  expect(n, 'now box').toBeTruthy();
  expect(t, 'trajectory box').toBeTruthy();
  expect(h, 'habits box').toBeTruthy();
  if (!n || !t || !h) return;
  expect(n.y).toBeLessThan(t.y);
  expect(t.y).toBeLessThan(h.y);
});

test('unread Coach chapters stay header-sized at 380 until a jump opens them', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach');

  const traj = page.getByTestId('coach-chapter-coach-trajectory');
  await expect(traj).toBeVisible();
  const closed = await traj.boundingBox();
  expect(closed, 'closed trajectory').toBeTruthy();
  if (!closed) return;
  expect(closed.height).toBeLessThan(140);
  await expect(traj).not.toHaveAttribute('open');
  await expect(page.getByTestId('fi-card')).not.toBeAttached();

  await page.getByTestId('coach-chapter-nav').getByRole('link', { name: 'Trajectory' }).click();
  await expect(traj).toHaveAttribute('open', '');
  await expect(traj).toBeFocused();
  await expect(page.getByTestId('fi-card')).toBeVisible();
  expect(
    await traj.evaluate((el) => el.hasAttribute('open') && Boolean(el.querySelector('[data-testid="fi-card"]'))),
  ).toBe(true);
  const opened = await traj.boundingBox();
  expect(opened, 'opened trajectory').toBeTruthy();
  if (!opened) return;
  expect(opened.height).toBeGreaterThan(closed.height + 80);

  const habits = page.getByTestId('coach-chapter-coach-habits');
  await expect(habits).toBeVisible();
  await expect(habits).not.toHaveAttribute('open');
  const habitsBox = await habits.boundingBox();
  expect(habitsBox, 'closed habits').toBeTruthy();
  if (!habitsBox) return;
  expect(habitsBox.height).toBeLessThan(140);
  await expect(page.getByTestId('money-rules-card')).not.toBeAttached();

  const marker = await traj.locator(':scope > summary').evaluate((el) => getComputedStyle(el).listStyleType);
  expect(marker).toMatch(/disclosure|disc/);

  await traj.locator(':scope > summary').click();
  await expect(traj).not.toHaveAttribute('open');
  await page.getByTestId('coach-chapter-nav').getByRole('link', { name: 'Trajectory' }).click();
  await expect(traj).toHaveAttribute('open', '');
  await expect(traj).toBeFocused();
});

test('a nested Coach hash opens the parent chapter', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach#coach-money-dials');

  const habits = page.getByTestId('coach-chapter-coach-habits');
  await expect(habits).toHaveAttribute('open', '');
  await expect(page.getByTestId('coach-money-dials')).toBeVisible();
  await expect(page.getByTestId('coach-money-dials')).toBeFocused();
  const outline = await page.getByTestId('coach-money-dials').evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await expect(page.getByTestId('coach-chapter-coach-trajectory')).not.toHaveAttribute('open');
  await expect(page.getByTestId('fi-card')).not.toBeAttached();
});

test('Change your assumptions opens Habits from a closed body', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach');

  await page.getByTestId('coach-chapter-nav').getByRole('link', { name: 'Trajectory' }).click();
  await expect(page.getByTestId('wealth-target-dials-link')).toBeVisible();
  await page.getByTestId('wealth-target-dials-link').click();
  await expect(page.getByTestId('coach-chapter-coach-habits')).toHaveAttribute('open', '');
  await expect(page.getByTestId('coach-money-dials')).toBeVisible();
  await expect(page.getByTestId('coach-money-dials')).toBeFocused();
});
