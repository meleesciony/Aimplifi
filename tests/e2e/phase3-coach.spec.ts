/**
 * Phase 3 golden flow (380×800): FI Coach — savings rate headline parity,
 * FI card with the live slider, opportunities, creep, runway, life-energy
 * toggle, and the monthly Money Review.
 */
import { expect, test } from '@playwright/test';

test('coach page: savings rate, FI slider moves the date live, life-energy toggle, money review', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  // headline parity on the dashboard: savings rate next to net worth
  await expect(page.getByTestId('net-worth-card')).toBeVisible();
  await expect(page.getByTestId('savings-rate-card')).toBeVisible();

  await page.getByTestId('bottom-nav-coach').click();
  await page.waitForURL('**/coach');

  // FI number present and formatted
  await expect(page.getByTestId('fi-number')).toContainText('$');
  await expect(page.getByTestId('savings-rate-amount')).toContainText('%');
  // Wave 1.4: demo seed has consecutive positive full months → streak and/or PB line
  await expect(page.getByTestId('savings-rate-streak').or(page.getByTestId('savings-rate-personal-best'))).toBeVisible();

  // interactive slider: dragging to a higher rate CHANGES the live caption
  const before = await page.getByTestId('slider-result').textContent();
  await page.getByTestId('fi-slider').fill('6000'); // 60% savings rate
  const after = await page.getByTestId('slider-result').textContent();
  expect(after).not.toBe(before);
  await expect(page.getByTestId('slider-rate')).toHaveText('60%');

  // opportunities ranked with the unused gym present, estimates labeled
  await expect(page.getByTestId('opportunities-list')).toContainText('LA Fitness');
  await expect(page.getByTestId('opportunities-list')).toContainText('Netflix');
  await expect(page.getByTestId('opportunities-card')).toContainText('est.');

  // creep flagged on the engineered seed rise — phrased as a question, not a verdict
  await expect(page.getByTestId('creep-verdict')).toContainText('not a verdict');

  // runway card
  await expect(page.getByTestId('runway-months')).toContainText('months');

  // #252 Money Signature: demo pinned copy (default-asOf narrative — see the
  // money-signature.test.ts seed lock for the hand math behind these literals).
  // Weather calm; saving habit steady 12/12 held since May 2025; spending
  // steadiness steady at 3.0% typical variation (spreadBps 296).
  await expect(page.getByTestId('money-signature-card')).toBeVisible();
  await expect(page.getByTestId('signature-weather')).toContainText('calm');
  await expect(page.getByTestId('signature-weather')).toContainText('cash ÷ your 6-month average expenses');
  await expect(page.getByTestId('signature-saving')).toContainText('12 of your last 12 full months with income');
  await expect(page.getByTestId('signature-saving')).toContainText('May 2025');
  await expect(page.getByTestId('signature-steadiness')).toContainText('3.0%');
  await expect(page.getByTestId('signature-steadiness')).toContainText('median');
  await expect(page.getByTestId('money-signature-card')).toContainText('3 months in a row');

  // #254 Habit streaks: demo pinned copy (default-asOf narrative — see the
  // cleared-streak / creep-streak seed locks for the hand math). Cleared-in-full
  // 17 months across 4 cards through May 2026; no-creep 3 full months with the
  // Netflix $15.49 → $17.99 (Feb 2026) increase as the last break, facts inline.
  await expect(page.getByTestId('habit-streaks-card')).toBeVisible();
  await expect(page.getByTestId('card-cleared-streak')).toContainText('17 months in a row');
  await expect(page.getByTestId('card-cleared-streak')).toContainText('paid in full by its due date');
  await expect(page.getByTestId('card-cleared-streak')).toContainText('(4 cards, 59 statements)');
  await expect(page.getByTestId('no-creep-streak')).toContainText('3 full months');
  await expect(page.getByTestId('no-creep-last-increase')).toContainText('Netflix, $15.49 → $17.99 in Feb 2026');

  // life-energy toggle flips $ → hours
  const firstRow = page.getByTestId('life-energy-list').locator('li').first();
  await expect(firstRow).toContainText('$');
  await page.getByTestId('life-energy-toggle').click();
  await expect(firstRow).toContainText('hrs');

  // Money Review: one improvement, one creep, one concrete next action.
  // In demo (no AI key) the §2.4 recap is the DETERMINISTIC floor — same three role lines,
  // and NO "Personalized" badge (the LLM ordering path only runs with a key).
  await expect(page.getByTestId('review-improvement')).not.toBeEmpty();
  await expect(page.getByTestId('review-creep')).not.toBeEmpty();
  await expect(page.getByTestId('review-next-action')).toContainText('One next action');
  await expect(page.getByTestId('review-personalized-badge')).toHaveCount(0);

  // Wave 1.3 value receipts: visiting /coach mints the seed's single price-increase
  // catch (Netflix $15.49 → $17.99 = $2.50/mo, keyed on its change date), so the
  // "What Aimplifi caught" card shows the tally — and a reload doesn't double-count
  // (the mint is idempotent per key).
  await expect(page.getByTestId('value-receipts-card')).toBeVisible();
  await expect(page.getByTestId('value-receipts-headline')).toContainText('1 catch so far');
  await expect(page.getByTestId('value-receipts-lines')).toContainText(
    '1 quiet price increase flagged — $2.50/mo in total.',
  );
  await page.reload();
  await expect(page.getByTestId('value-receipts-headline')).toContainText('1 catch so far');

  // the educational disclaimer is on the page (global footer)
  await expect(page.locator('text=not financial advice')).toBeVisible();
});

