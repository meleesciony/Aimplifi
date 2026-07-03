/**
 * Root 404 chrome (DECISIONS #157, 380×800 viewport).
 *
 * Middleware redirects an unauthenticated visitor to /sign-in for most unmatched
 * paths (src/middleware.ts), so the branded 404 is normally reached by an
 * AUTHENTICATED user — we sign in (demo) first, then GET a bogus path. (A few paths
 * under an unanchored middleware exclusion prefix render the 404 without a session,
 * but that couples to a middleware quirk, so this spec locks the two INTENDED,
 * robust behaviours instead: authed unmatched → branded 404; unauthed unmatched →
 * /sign-in.) This is a pure-navigation flow (one sign-in action, then GETs) — no
 * rapid sequential server actions — so it is NOT subject to the environmental
 * action-apply stall (STATUS #16/#17).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('an unmatched URL renders the branded 404 with a 404 status and a working recovery', async ({
  page,
}) => {
  // Authenticate first (unauthenticated unmatched paths redirect to /sign-in).
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  // A genuinely unmatched path → Next serves the root not-found with a 404 status.
  const res = await page.goto('/this-page-does-not-exist');
  expect(res?.status()).toBe(404);

  // Branded, recoverable content is present.
  const notFound = page.getByTestId('not-found');
  await expect(notFound).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(notFound).toContainText('Aimplifi');

  // The tab title flows through the root template (part of the "feels native" win).
  await expect(page).toHaveTitle('Page not found · Aimplifi');

  // It renders OUTSIDE the authenticated app shell — no nav chrome bleeds onto a 404.
  await expect(page.getByTestId('bottom-nav')).toHaveCount(0);
  await expect(page.getByTestId('nav-dashboard')).toHaveCount(0);

  // Accessible: WCAG 2.0/2.1 A + AA clean on this standalone surface.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  // Recovery: the single clear action returns the user to the real, authed app.
  await page.getByTestId('not-found-home').click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByTestId('cash-needed-amount')).toBeVisible();
});

test('an unauthenticated unmatched URL is redirected to sign-in, never shown the bare 404', async ({
  page,
}) => {
  // The INTENDED middleware boundary (robust — not the icon*/manifest* quirk): no
  // session + a matched (non-excluded) unmatched path → redirect to /sign-in, so the
  // nav-less 404 is never served to a logged-out visitor.
  await page.goto('/this-page-does-not-exist');
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByTestId('not-found')).toHaveCount(0);
});
