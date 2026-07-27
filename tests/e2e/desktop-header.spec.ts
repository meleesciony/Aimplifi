/**
 * Desktop header alignment (#188): after #187 the nav took flex-1 and 13 text
 * links could overflow into Sign out. Locks non-overlap via bounding boxes at
 * a desktop viewport (e2e project is mobile-380 by default — resize in-test).
 */
import { expect, test } from './helpers/test';

test('desktop header: Settings and Sign out do not overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  // Desktop text links are visible; More stays mounted with sm:hidden (count 1).
  await expect(page.getByTestId('nav-more')).not.toBeVisible();
  const settings = page.getByTestId('desktop-nav-settings');
  const signOut = page.getByTestId('sign-out-form');
  await expect(settings).toBeVisible();
  await expect(signOut).toBeVisible();

  const s = await settings.boundingBox();
  const o = await signOut.boundingBox();
  expect(s, 'Settings link bounding box').toBeTruthy();
  expect(o, 'Sign out bounding box').toBeTruthy();
  if (!s || !o) return;

  // No horizontal overlap: Settings ends strictly left of Sign out.
  expect(s.x + s.width).toBeLessThanOrEqual(o.x + 0.5);
});
