/**
 * Merchant Pattern Lens (AI plan §Later #19, DECISIONS #250) — demo golden path.
 *
 * Render-only: filtering the register and reading the lens never mutates state,
 * so this spec is safe against the shared demo seed (the #182/#234 precedent).
 *
 * Pinned figures are the demo seed truths at asOf 2026-06-10, hand-checked in
 * merchant-profile.test.ts's seed lock (typical $11.56 = the radar's own
 * baseline median — the two surfaces agree by construction). If a seed change
 * breaks these pins, re-verify BOTH this spec and the seed lock together (the
 * #249 stale-pin lesson).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

test('tapping a merchant name filters the register and shows the lens', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');

  // The seed's PENDING Blue Bottle charge is dated asOf, so a link is on page 1.
  await page
    .getByTestId('txn-merchant-link')
    .filter({ hasText: 'Blue Bottle Coffee' })
    .first()
    .click();
  await page.waitForURL('**/transactions?merchant=*');

  const lens = page.getByTestId('merchant-lens');
  await expect(lens).toBeVisible();
  await expect(lens.getByRole('heading', { name: 'Your pattern at Blue Bottle Coffee' })).toBeVisible();

  // Every row on the filtered register is this merchant (exact match, so the
  // filter can never smuggle in a "Blue Bottle Bakery").
  const links = page.getByTestId('txn-merchant-link');
  const n = await links.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(links.nth(i)).toHaveText('Blue Bottle Coffee');
  }
});

test('lens narration renders the seed truths verbatim (median = the radar baseline)', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions?merchant=Blue%20Bottle%20Coffee');

  const lens = page.getByTestId('merchant-lens');
  await expect(lens).toBeVisible();
  await expect(lens.getByTestId('merchant-lens-facts')).toHaveText(
    '19 charges since Jan 2025 — $409.01 in all; the last was Tue, Jun 9, 2026.',
  );
  await expect(lens.getByTestId('merchant-lens-typical')).toHaveText(
    'Typically $11.56 a charge (median of 19 posted charges).',
  );
  await expect(lens.getByTestId('merchant-lens-trend')).toHaveText(
    'Mar 2026–May 2026: 4 charges, about $16.63/mo — vs about $10.09/mo in Dec 2025–Feb 2026.',
  );
  // The basis disclosures the copy rules require (#250 critic F5: the card is
  // full-history while the list below may be filtered or paginated).
  await expect(lens).toContainText("the current month isn't counted");
  await expect(lens.getByTestId('merchant-lens-scope')).toContainText(
    'Covers every posted charge at this merchant',
  );

  // Accessibility gate (same tags as the today-feed spec).
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, 'axe violations on merchant lens').toEqual([]);
});

test('clearing the lens returns to the unfiltered register', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions?merchant=Blue%20Bottle%20Coffee');
  await page.getByTestId('merchant-lens-clear').click();
  await page.waitForURL('**/transactions');
  await expect(page.getByTestId('merchant-lens')).toHaveCount(0);
});

test('aggregate pseudo-merchant filter shows rows but NO lens (honest abstention)', async ({ page }) => {
  await signIn(page);
  // Zelle bundles many unrelated payees behind one canonical — a "pattern"
  // there would be a fabricated relationship, so the engine abstains.
  await page.goto('/transactions?merchant=Zelle%20Payment');
  await expect(page.getByTestId('txn-filters')).toBeVisible();
  await expect(page.getByTestId('merchant-lens')).toHaveCount(0);
});
