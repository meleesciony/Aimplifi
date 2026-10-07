/**
 * UI.1 — the visual system pass (DECISIONS #793), measured in the browser.
 *
 * Phone (the project's 380×800 viewport): the header's sign-out is an icon
 * with the accessible name "Sign out" at the 44px tap floor; the demo banner
 * is one line; the Home stage's guilt-free card carries its split bar.
 * Desktop: the two stage cards sit on one top edge and the guilt-free card is
 * never taller than the stage it pairs with; the active sidebar row is marked
 * both by `aria-current` and a visible tint; every feed row carries a glyph
 * whose tone matches its kind.
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
  // The 44px floor, on both axes (M.2: an icon-only control carries its own width).
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);

  const banner = page.getByTestId('demo-banner');
  await expect(banner).toBeVisible();
  const bannerBox = await banner.boundingBox();
  expect(bannerBox, 'demo banner bounding box').toBeTruthy();
  // text-xs on one line is ~26px tall with the pill padding; a wrap is ≥ 40px.
  expect(bannerBox!.height).toBeLessThan(34);
  // innerText, not textContent: the wide-screen phrase is in the DOM but display:none here.
  await expect(banner).toHaveText(/Demo dataset · as of/, { useInnerText: true });
  // The pill's text stays inside the pill (no spill past the rounded edge).
  const spill = await banner.evaluate((el) => {
    const inner = el.querySelector('span:last-child') as HTMLElement;
    return inner.getBoundingClientRect().right - el.getBoundingClientRect().right;
  });
  expect(spill).toBeLessThanOrEqual(0);

  await expect(page.getByTestId('dashboard-safe-to-spend-split')).toBeVisible();
  await expect(page.getByTestId('dashboard-safe-to-spend-split')).toHaveText(/Fixed[\s\S]*Savings[\s\S]*Guilt-free/);
});

test('desktop shell: stage pair shares a top edge, active sidebar row is tinted, feed glyphs match their kind', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const cash = await page.getByTestId('cash-needed-card').boundingBox();
  const guilt = await page.getByTestId('dashboard-safe-to-spend').boundingBox();
  expect(cash, 'cash-needed bounding box').toBeTruthy();
  expect(guilt, 'guilt-free bounding box').toBeTruthy();
  expect(Math.abs(cash!.y - guilt!.y)).toBeLessThanOrEqual(1);
  // Not stretched to the stage's height (critic P2-3: a stretched card was a
  // 400px blank link), and not wider than its 2/5 column.
  expect(guilt!.height).toBeLessThanOrEqual(cash!.height);
  expect(guilt!.x).toBeGreaterThan(cash!.x + cash!.width);

  const home = page.getByTestId('nav-dashboard');
  await expect(home).toHaveAttribute('aria-current', 'page');
  const bg = await home.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  const cards = page.getByTestId('nav-cards');
  const idleBg = await cards.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(idleBg).toBe('rgba(0, 0, 0, 0)');

  // Every Today-feed row carries a decorative glyph (aria-hidden) whose tone is
  // the helper's verdict for its kind and tier — the demo's price-increase row
  // must be warning, never brand.
  const rows = page.locator('[data-testid="today-feed-card"] [data-testid^="nudge-"][data-tier]');
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const glyph = rows.nth(i).locator('span[aria-hidden][data-glyph-tone]').first();
    await expect(glyph.locator('svg')).toBeVisible();
    const kind = await rows.nth(i).getAttribute('data-testid');
    const tone = await glyph.getAttribute('data-glyph-tone');
    if (kind === 'nudge-price-increase') expect(tone).toBe('warning');
    if (kind === 'nudge-income_pause') {
      const tier = await rows.nth(i).getAttribute('data-tier');
      expect(tone).toBe(tier === 'handled' ? 'muted' : 'warning');
    }
  }
});
