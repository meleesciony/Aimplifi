/**
 * Cash Flow Radar dashboard card (DECISIONS #172 — AI plan §1.2, Gap 2 §1).
 *
 * The pinned demo seed (today 2026-06-10) projects a committed-only dip on
 * 2026-06-24 (after the Jun-15 Platinum + Sapphire dues, rent tips it under),
 * with the minimum cover-transfer $6,950.00 by Tue Jun 23 sourced from
 * High-Yield Savings — verified engine output pinned by tests/unit/radar*
 * (worst dip −694399¢ on 09-01 → next $50 = 695000¢, post-critic P1-1 basis fix).
 * This spec asserts the card renders that state with the guardrail copy
 * ("never moves money") and passes axe. Amount asserted exactly (the seed is
 * deterministic); dates on their stable formatted parts.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './helpers/test';

test('demo dashboard shows the radar heads-up: dip date, colliding cards, minimum timed cover', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  const card = page.getByTestId('cash-flow-radar-card');
  await expect(card).toBeVisible({ timeout: 20000 });

  // Committed-only alarm state on the seed.
  await expect(page.getByTestId('radar-status')).toHaveText('Heads-up');
  await expect(card).toContainText('dip below $0');
  await expect(card).toContainText('Wed, Jun 24'); // the projected dip date

  // Names the colliding cards (the dues the dip follows).
  const colliding = page.getByTestId('radar-colliding');
  await expect(colliding).toContainText('Platinum Card');
  await expect(colliding).toContainText('Sapphire Card');

  // The minimum timed cover-transfer, deposit-sourced, with the no-action guardrail.
  const cover = page.getByTestId('radar-cover');
  await expect(cover).toContainText('$6,950.00');
  await expect(cover).toContainText('Tue, Jun 23');
  await expect(cover).toContainText('High-Yield Savings');
  await expect(cover).toContainText('Aimplifi never moves money');

  // Estimated future cycles are disclosed inline (adjudicated condition 3).
  await expect(card).toContainText('includes estimated future statements');

  // Assumptions are one tap away and state the committed-only basis.
  await card.locator('summary').click();
  await expect(card).toContainText('no spending estimate is mixed into it');

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
});
