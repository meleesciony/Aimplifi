/**
 * Return-moment greeting (TASKS 1.1) — golden-safety on the demo user.
 *
 * The "Since you were away" card only appears after a >7-day gap since the last
 * dashboard view. The demo provider's "today" is FIXED (2026-06-10), so the demo
 * user's first load stamps last-seen = 2026-06-10 and every later load sees a
 * 0-day gap → the card never renders. This locks that: the demo dashboard shows
 * its normal cards and NO return-moment greeting (no false "welcome back").
 *
 * The positive/return render path (a real >7-day gap) is proven deterministically
 * by tests/unit/return-moment.test.ts (engine) and return-moment-server.test.ts
 * (real getReturnMoment against a throwaway user) — it can't be seeded on the
 * shared, fixed-today demo user under fullyParallel without racing the auto-stamp.
 */
import { expect, test } from './helpers/test';

test('demo dashboard renders normally and shows no return-moment greeting', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // Dashboard rendered (the headline answer and the radar card both present) —
  // proving the new compose-and-stamp path didn't break the page.
  await expect(page.getByTestId('cash-needed-card')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('cash-flow-radar-card')).toBeVisible();

  // No welcome-back greeting for the fixed-today demo user (golden-safe).
  await expect(page.getByTestId('return-moment-card')).toHaveCount(0);

  // A reload still shows no greeting (last-seen was stamped to the same fixed today).
  await page.reload();
  await expect(page.getByTestId('cash-needed-card')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('return-moment-card')).toHaveCount(0);
});
