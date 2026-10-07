/**
 * UI.1 — the visual system pass (DECISIONS #793), measured in the browser.
 *
 * Phone (the project's 380×800 viewport): the header's sign-out is an icon
 * with the accessible name "Sign out" and a real tap target; the demo banner
 * is one line; the Home stage's guilt-free card carries its split bar.
 * Desktop: the two stage cards are one height, and the active sidebar row is
 * marked both by `aria-current` and a visible tint.
 *
 * Mid-viewport elements only (no fixed-bottom-nav clicks — lesson
 * `mobile-380-viewport-scaling-flake.md`).
 */
import { expect, test } from './helpers/test';

test('phone shell: icon sign-out keeps its name, banner is one line, stage carries the split', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const signOut = page.getByTestId('sign-out-form').getByRole('button', { name: 'Sign out' });
  await expect(signOut).toBeVisible();
  const box = await signOut.boundingBox();
  expect(box, 'sign-out bounding box').toBeTruthy();
  // 44px floor on the coarse-pointer project (tap-target); the word is sr-only.
  expect(box!.height).toBeGreaterThanOrEqual(40);
  expect(box!.width).toBeGreaterThanOrEqual(36);
  expect(box!.width).toBeLessThanOrEqual(56);

  const banner = page.getByTestId('demo-banner');
  await expect(banner).toBeVisible();
  const bannerBox = await banner.boundingBox();
  expect(bannerBox, 'demo banner bounding box').toBeTruthy();
  // text-xs on one line is ~26px tall with the pill padding; a wrap is ≥ 40px.
  expect(bannerBox!.height).toBeLessThan(34);
  // innerText, not textContent: the desktop phrase is in the DOM but display:none here.
  await expect(banner).toHaveText(/Demo dataset · as of/, { useInnerText: true });

  await expect(page.getByTestId('dashboard-safe-to-spend-split')).toBeVisible();
  await expect(page.getByTestId('dashboard-safe-to-spend-split')).toHaveText(/Fixed[\s\S]*Savings[\s\S]*Guilt-free/);
});

test('desktop shell: stage pair is one height, active sidebar row is tinted', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const cash = await page.getByTestId('cash-needed-card').boundingBox();
  const guilt = await page.getByTestId('dashboard-safe-to-spend').boundingBox();
  expect(cash, 'cash-needed bounding box').toBeTruthy();
  expect(guilt, 'guilt-free bounding box').toBeTruthy();
  expect(Math.abs(cash!.height - guilt!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(cash!.y - guilt!.y)).toBeLessThanOrEqual(1);

  const home = page.getByTestId('nav-dashboard');
  await expect(home).toHaveAttribute('aria-current', 'page');
  const bg = await home.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  const cards = page.getByTestId('nav-cards');
  const idleBg = await cards.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(idleBg).toBe('rgba(0, 0, 0, 0)');

  // Every Today-feed row carries a glyph; the glyph is decorative (aria-hidden).
  const rows = page.locator('[data-testid="today-feed-card"] [data-testid^="nudge-"][data-tier]');
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(rows.nth(i).locator('span[aria-hidden] svg').first()).toBeVisible();
  }
});
