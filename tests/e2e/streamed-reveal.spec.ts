/**
 * O.3 regression lock — a frame-starved renderer must still reveal streamed Suspense content.
 *
 * React defers the first reveal on a document behind `requestAnimationFrame` (see the mechanism
 * write-up in `tests/e2e/helpers/test.ts`). This drives the exact condition — a renderer that
 * issues no frames — and proves the harness's drain stands in for the missing frame.
 *
 * The two non-vacuity guards matter as much as the outcome:
 *   • the starvation is asserted, not assumed (a rAF scheduled from the test must NOT call back),
 *   • `$RT` is asserted to be a number, and `$RT` is assigned on the first line of `$RV`, so it
 *     proves a boundary really was streamed AND really was drained. On a page that never suspends
 *     it stays `undefined` and this test fails rather than passing on nothing.
 */
import { expect, test, type Page } from './helpers/test';

async function signUpThrowaway(page: Page): Promise<void> {
  const email = `e2e-reveal-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

test('a streamed boundary is revealed even when no animation frame ever arrives', async ({
  page,
}) => {
  await signUpThrowaway(page);

  // The starvation: keep the API shape, drop the callback. This is what a non-painting renderer
  // looks like to React's reveal machinery.
  await page.addInitScript(() => {
    window.requestAnimationFrame = ((): number => 0) as typeof window.requestAnimationFrame;
  });

  await page.goto('/accounts');

  // The content reaches the reader — strictly, so a second copy would fail here too.
  await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 20_000 });

  // Guard 1: the hard case is genuinely present — no frame callback is being delivered.
  const frameFired = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        let fired = false;
        requestAnimationFrame(() => {
          fired = true;
        });
        setTimeout(() => resolve(fired), 500);
      }),
  );
  expect(frameFired).toBe(false);

  const state = await page.evaluate(() => {
    const w = window as unknown as { $RB?: unknown[]; $RT?: unknown };
    return {
      stagingContainers: document.querySelectorAll('div[hidden][id^="S:"]').length,
      rbLength: Array.isArray(w.$RB) ? w.$RB.length : -1,
      rtType: typeof w.$RT,
    };
  });

  // Guard 2: `$RV` ran — which only happens if a boundary was queued and then drained.
  expect(state.rtType).toBe('number');
  // Nothing left staged, and nothing left queued.
  expect(state.stagingContainers).toBe(0);
  expect(state.rbLength).toBe(0);
});
