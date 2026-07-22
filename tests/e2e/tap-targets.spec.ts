/**
 * Wave M.2 — the tap-target floor gate (docs/MOBILE_UI_BRIEF.md).
 *
 * WHY THIS FILE EXISTS: the finance list controls rendered ~20px tall
 * (px-1.5 py-0.5 text-xs) and even the shadcn Button primitive tops out at
 * h-8/32px — all under the 44×44pt iOS / 48dp Android minimum. A 20px Delete
 * button next to a 20px Edit button is a fair description of "doesn't work right
 * on my phone" (the owner's report). M.2 added ONE shared primitive — the
 * `.tap-target` token (globals.css), applied to the Button base and every
 * hand-rolled control — that grows a control's hit box to a 44px floor ON
 * TOUCH-PRIMARY DEVICES ONLY (`@media (pointer: coarse)`), leaving desktop
 * compact.
 *
 * This spec locks that floor two ways, so a future edit that drops the token or
 * the coarse-pointer rule fails here:
 *   • the shadcn <Button> primitive (demo-sign-in on the public /sign-in page),
 *   • a hand-rolled control carrying `.tap-target` (the /accounts add buttons).
 *
 * It runs under the mobile-380 project (Pixel 5 — isMobile/hasTouch, so the
 * browser reports `pointer: coarse` and the floor is live). If this ever fails
 * with heights near 32px, the coarse-pointer media query is not matching in the
 * emulator and the floor must move to unconditional — but that is a real signal,
 * not a flake.
 */
import { expect, test, type Locator } from '@playwright/test';

// iOS HIG asks 44pt; Android 48dp. The token floors at 44px (min-height: 2.75rem);
// assert the border-box height clears it. -0.5 absorbs sub-pixel rounding only.
const MIN_TAP_PX = 44;

async function expectTapFloor(control: Locator, label: string) {
  await expect(control, `${label} should be visible before measuring`).toBeVisible();
  const box = await control.boundingBox();
  expect(box, `${label} has no bounding box`).not.toBeNull();
  expect(
    box!.height,
    `${label} hit box is ${box!.height}px tall — under the ${MIN_TAP_PX}px tap-target floor. ` +
      'A finger-sized control is the difference between usable and "broken on my phone".',
  ).toBeGreaterThanOrEqual(MIN_TAP_PX - 0.5);
}

test('the shadcn Button primitive meets the 44px tap-target floor on touch devices', async ({
  page,
}) => {
  await page.goto('/sign-in');
  // demo-sign-in is a plain shadcn <Button variant="outline"> (default size h-8
  // = 32px). Its height clearing 44 proves the primitive-base `.tap-target` bump.
  await expectTapFloor(page.getByTestId('demo-sign-in'), 'demo-sign-in Button');
});

test('hand-rolled /accounts controls meet the 44px tap-target floor', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/accounts');
  // The add buttons are always present (no seed dependency) and are hand-rolled
  // <button>s carrying `.tap-target` — they lock the utility, not the primitive.
  await expectTapFloor(page.getByTestId('add-asset-btn'), '/accounts Add asset');
  await expectTapFloor(page.getByTestId('add-liability-btn'), '/accounts Add liability');
});
