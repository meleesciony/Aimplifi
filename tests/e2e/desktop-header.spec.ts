/**
 * Desktop sidebar (#757): grouped nav replaces the wrapping 19-pill header.
 * Settings and Sign out stack in the sidebar — they must not overlap.
 */
import { expect, test } from './helpers/test';

test('desktop sidebar: Settings and Sign out do not overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await expect(page.getByTestId('nav-more')).not.toBeVisible();
  await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
  await expect(page.getByTestId('desktop-nav-spending-plan')).toHaveText(/Guilt-free/);
  await expect(page.getByTestId('desktop-nav-trends')).toHaveText('Trends');
  await expect(page.getByTestId('desktop-nav-trends')).toHaveAttribute('title', /Category movers/);
  const settings = page.getByTestId('desktop-nav-settings');
  const signOut = page.getByTestId('desktop-sign-out-form');
  await expect(settings).toBeVisible();
  await expect(signOut).toBeVisible();

  const s = await settings.boundingBox();
  const o = await signOut.boundingBox();
  expect(s, 'Settings link bounding box').toBeTruthy();
  expect(o, 'Sign out bounding box').toBeTruthy();
  if (!s || !o) return;

  // Stacked: Settings ends strictly above Sign out; no box overlap.
  expect(s.y + s.height).toBeLessThanOrEqual(o.y + 0.5);
});
