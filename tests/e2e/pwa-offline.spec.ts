/**
 * PWA offline support (ROADMAP #5): the service worker registers (production
 * build) and an offline navigation falls back to the precached /offline shell
 * instead of the browser's error page. 380×800.
 *
 * The SW is network-first for navigations, so this is the ONLY spec that goes
 * offline — every other spec always hits the network (fresh), unaffected.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('service worker registers and an offline reload shows the offline shell', async ({ page, context }) => {
  await signIn(page);

  // The SW registers on window-load (production build) and claims the page.
  await page.waitForFunction(
    async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg && reg.active);
    },
    undefined,
    { timeout: 20000 },
  );
  // `ready` resolves with an active SW; the /offline shell is precached at install.
  await page.evaluate(() => navigator.serviceWorker.ready);

  // Offline navigation → the SW serves the precached /offline shell, not a crash.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-heading')).toBeVisible({ timeout: 10000 });

  await context.setOffline(false);
});
